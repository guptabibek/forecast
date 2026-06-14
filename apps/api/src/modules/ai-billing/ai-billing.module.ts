import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { AiAccessService } from './access.service';
import { AiBillingAdminController } from './ai-billing-admin.controller';
import { AiBillingController } from './ai-billing.controller';
import { BillingAuditService } from './billing-audit.service';
import { BillingReportingService } from './billing-reporting.service';
import { AiChargeService } from './charge.service';
import { DisputeService } from './dispute.service';
import { PricingService } from './pricing.service';
import { PurchaseService } from './purchase.service';
import { RefundService } from './refund.service';
import { AiRegistryService } from './registry.service';
import { StripeClient } from './stripe.client';
import { StripeWebhookController } from './stripe-webhook.controller';
import { WalletService } from './wallet.service';

/**
 * Background sweep: release credit holds whose caller died mid-request and
 * expire abandoned card purchases whose webhook never arrived.
 */
@Injectable()
export class ReservationSweepScheduler {
  constructor(
    private readonly wallet: WalletService,
    private readonly purchases: PurchaseService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    await this.wallet.expireStaleReservations();
    await this.purchases.expireStaleStripePurchases();
  }
}

/**
 * AI Billing, Credit Management & Governance Platform.
 *
 * Centralized, super-admin-managed providers/models/pricing; per-tenant
 * prepaid credit wallets with an append-only financial ledger; reservation-
 * based charging around every AI request; Stripe + bank-transfer purchase
 * rails; disputes, refunds, access governance, immutable audit, reporting.
 *
 * Exports AiChargeService + AiRegistryService for the AI execution pipeline
 * (ai-reporting) — the ONLY billing surface other modules may touch.
 */
@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AiBillingAdminController, AiBillingController, StripeWebhookController],
  providers: [
    BillingAuditService,
    WalletService,
    PricingService,
    AiRegistryService,
    AiAccessService,
    StripeClient,
    PurchaseService,
    RefundService,
    DisputeService,
    BillingReportingService,
    AiChargeService,
    ReservationSweepScheduler,
  ],
  exports: [AiChargeService, AiRegistryService, WalletService, AiAccessService],
})
export class AiBillingModule {}
