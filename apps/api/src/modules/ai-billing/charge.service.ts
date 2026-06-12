import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModelPricing, AiReservationStatus, AiUsageBillingStatus, Prisma, TenantTier } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AiAccessService } from './access.service';
import { PricingMissingError } from './billing.errors';
import { PricingService } from './pricing.service';
import { WalletService } from './wallet.service';

const D = (value: Prisma.Decimal | number | string): Prisma.Decimal => new Prisma.Decimal(value);

export interface ChargeTicket {
  /** False when billing enforcement is off — usage is still logged (UNBILLED). */
  billed: boolean;
  tenantId: string;
  userId: string | null;
  providerId: string | null;
  providerName: string;
  modelId: string | null;
  modelCode: string;
  callType: string;
  reservationId: string | null;
  pricing: AiModelPricing | null;
  estimatedCharge: string;
}

export interface SettleUsage {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

/**
 * The single billing touchpoint for the AI execution pipeline:
 *
 *   prepare()  — validate access, resolve pricing, estimate cost, RESERVE
 *   settle()   — compute ACTUAL cost from real token usage, FINALIZE the
 *                reservation (charge) or RELEASE it (failed request), and
 *                write the token-level usage log with the money trail.
 *
 * Enforcement is controlled by AI_BILLING_ENFORCEMENT (default ON). With
 * enforcement off, requests run unbilled but usage is still recorded with
 * provider cost for analytics — the platform owner flips it on once wallets
 * are funded.
 */
@Injectable()
export class AiChargeService {
  private readonly logger = new Logger(AiChargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly pricing: PricingService,
    private readonly access: AiAccessService,
    private readonly config: ConfigService,
  ) {}

  enforcementEnabled(): boolean {
    const raw = String(this.config.get('AI_BILLING_ENFORCEMENT') ?? 'true').trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(raw);
  }

  async prepare(input: {
    tenantId: string;
    userId?: string | null;
    providerId?: string | null;
    providerName: string;
    modelId?: string | null;
    modelCode: string;
    callType: string;
    estimatedPromptTokens: number;
    maxCompletionTokens: number;
  }): Promise<ChargeTicket> {
    const base: Omit<ChargeTicket, 'billed' | 'reservationId' | 'pricing' | 'estimatedCharge'> = {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      providerId: input.providerId ?? null,
      providerName: input.providerName,
      modelId: input.modelId ?? null,
      modelCode: input.modelCode,
      callType: input.callType,
    };

    const planTier = await this.tenantTier(input.tenantId);
    const pricing = input.modelId
      ? await this.pricing.resolvePricing(input.modelId, { tenantId: input.tenantId, planTier })
      : null;

    if (!this.enforcementEnabled()) {
      return { ...base, billed: false, reservationId: null, pricing, estimatedCharge: '0' };
    }
    if (!pricing) {
      // Financial-grade rule: a billable model without pricing must not run.
      throw new PricingMissingError(`No active pricing for model ${input.modelCode}`);
    }

    const estimatedCharge = this.pricing.estimateCharge(pricing, {
      promptTokens: input.estimatedPromptTokens,
      maxCompletionTokens: input.maxCompletionTokens,
    });
    await this.access.assertAccess({
      tenantId: input.tenantId,
      userId: input.userId,
      planTier,
      modelCode: input.modelCode,
      estimatedCharge,
    });
    const reservation = await this.wallet.reserveCredits({
      tenantId: input.tenantId,
      userId: input.userId,
      amount: estimatedCharge.greaterThan(0) ? estimatedCharge : D('0.000001'),
    });
    return { ...base, billed: true, reservationId: reservation.id, pricing, estimatedCharge: estimatedCharge.toFixed(6) };
  }

  /**
   * Settle the ticket after the AI call. Never throws into the caller's hot
   * path for bookkeeping problems — a failed settle is logged loudly, but the
   * user already has (or definitively does not have) their answer.
   */
  async settle(
    ticket: ChargeTicket,
    outcome: { success: boolean; usage?: SettleUsage; executionMs?: number; requestId?: string | null },
  ): Promise<void> {
    try {
      const usage = outcome.usage ?? {};
      const tokens = {
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        cachedTokens: usage.cachedTokens ?? 0,
        reasoningTokens: usage.reasoningTokens ?? 0,
      };
      const cost = ticket.pricing
        ? this.pricing.computeCost(ticket.pricing, tokens)
        : { providerCost: D(0), customerCharge: D(0), margin: D(0), pricingId: null as string | null };

      let transactionId: string | null = null;
      let billingStatus: AiUsageBillingStatus = AiUsageBillingStatus.UNBILLED;

      if (ticket.reservationId) {
        if (outcome.success) {
          const result = await this.wallet.finalizeReservation(ticket.reservationId, cost.customerCharge, {
            createdById: ticket.userId,
            requestId: outcome.requestId ?? null,
            notes: `${ticket.modelCode} ${ticket.callType}`,
            metadata: { tokens: usage.totalTokens ?? tokens.promptTokens + tokens.completionTokens },
          });
          transactionId = result.transaction?.id ?? null;
          billingStatus = AiUsageBillingStatus.CHARGED;
        } else {
          await this.wallet.releaseReservation(ticket.reservationId, AiReservationStatus.RELEASED);
          billingStatus = AiUsageBillingStatus.FAILED;
        }
      } else if (!outcome.success) {
        billingStatus = AiUsageBillingStatus.FAILED;
      }

      await this.prisma.aiUsageLog.create({
        data: {
          tenantId: ticket.tenantId,
          userId: ticket.userId,
          providerId: ticket.providerId,
          providerName: ticket.providerName,
          modelId: ticket.modelId,
          modelCode: ticket.modelCode,
          requestId: outcome.requestId ?? null,
          callType: ticket.callType,
          promptTokens: tokens.promptTokens,
          completionTokens: tokens.completionTokens,
          cachedTokens: tokens.cachedTokens,
          reasoningTokens: tokens.reasoningTokens,
          totalTokens: usage.totalTokens ?? tokens.promptTokens + tokens.completionTokens,
          executionMs: outcome.executionMs ?? null,
          providerCost: cost.providerCost,
          customerCharge: outcome.success && ticket.billed ? cost.customerCharge : D(0),
          margin: outcome.success && ticket.billed ? cost.margin : cost.providerCost.negated(),
          reservationId: ticket.reservationId,
          transactionId,
          pricingId: ticket.pricing?.id ?? null,
          status: billingStatus,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `AI billing settle failed (tenant=${ticket.tenantId}, reservation=${ticket.reservationId}): ${String(error?.message ?? error)}`,
      );
    }
  }

  private async tenantTier(tenantId: string): Promise<TenantTier | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { tier: true } });
    return tenant?.tier ?? null;
  }
}
