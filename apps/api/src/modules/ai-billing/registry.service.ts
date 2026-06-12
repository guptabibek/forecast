import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiBillingModelStatus, AiBillingProviderStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingNotFoundError, BillingValidationError } from './billing.errors';
import { decryptBillingSecret, deriveBillingKey, encryptBillingSecret } from './secret-crypto.util';

const PROVIDER_KINDS = ['openai', 'anthropic', 'gemini', 'azure_openai', 'custom'] as const;
/** Kinds the current execution pipeline can call (OpenAI-compatible chat API). */
const EXECUTABLE_KINDS = new Set(['openai', 'azure_openai', 'custom']);

export interface ExecutionTarget {
  provider: {
    id: string;
    name: string;
    kind: string;
    apiKey: string;
    endpointUrl: string | null;
    organizationId: string | null;
  };
  model: {
    id: string;
    modelCode: string;
    displayName: string;
    maxContext: number | null;
  };
}

/**
 * Central registry of AI providers and models — SUPER ADMIN ONLY surface.
 * API keys are AES-256-GCM encrypted at rest, exposed to callers only as
 * last-4, and decrypted exclusively for backend execution. Tenants never
 * configure providers, keys, endpoints, or models.
 */
@Injectable()
export class AiRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: BillingAuditService,
  ) {}

  // ── Providers ──────────────────────────────────────────────────────────────

  async listProviders() {
    const rows = await this.prisma.aiBillingProvider.findMany({
      orderBy: { priority: 'asc' },
      include: { _count: { select: { models: true } } },
    });
    return rows.map((row) => this.maskProvider(row));
  }

  async createProvider(
    input: { name: string; kind: string; apiKey?: string; endpointUrl?: string; organizationId?: string; priority?: number; status?: AiBillingProviderStatus },
    actor: { id?: string; email?: string; role?: string; ip?: string },
  ) {
    if (!PROVIDER_KINDS.includes(input.kind as any)) {
      throw new BillingValidationError(`Provider kind must be one of: ${PROVIDER_KINDS.join(', ')}`);
    }
    const created = await this.prisma.aiBillingProvider.create({
      data: {
        name: input.name.trim(),
        kind: input.kind,
        ...this.encryptKeyFields(input.apiKey),
        endpointUrl: input.endpointUrl?.trim() || null,
        organizationId: input.organizationId?.trim() || null,
        priority: input.priority ?? 100,
        status: input.status ?? AiBillingProviderStatus.ACTIVE,
      },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      action: 'PROVIDER_CREATED', entityType: 'ai_billing_provider', entityId: created.id,
      afterState: this.maskProvider(created),
    });
    return this.maskProvider(created);
  }

  async updateProvider(
    id: string,
    input: { name?: string; kind?: string; apiKey?: string | null; clearApiKey?: boolean; endpointUrl?: string | null; organizationId?: string | null; priority?: number; status?: AiBillingProviderStatus },
    actor: { id?: string; email?: string; role?: string; ip?: string },
  ) {
    const before = await this.prisma.aiBillingProvider.findUnique({ where: { id } });
    if (!before) throw new BillingNotFoundError('Provider not found');
    if (input.kind && !PROVIDER_KINDS.includes(input.kind as any)) {
      throw new BillingValidationError(`Provider kind must be one of: ${PROVIDER_KINDS.join(', ')}`);
    }
    const updated = await this.prisma.aiBillingProvider.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.clearApiKey ? { apiKeyEncrypted: null, apiKeyLast4: null } : this.encryptKeyFields(input.apiKey ?? undefined)),
        ...(input.endpointUrl !== undefined ? { endpointUrl: input.endpointUrl?.trim() || null } : {}),
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId?.trim() || null } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      action: 'PROVIDER_UPDATED', entityType: 'ai_billing_provider', entityId: id,
      beforeState: this.maskProvider(before), afterState: this.maskProvider(updated),
    });
    return this.maskProvider(updated);
  }

  async deleteProvider(id: string, actor: { id?: string; email?: string; role?: string; ip?: string }) {
    const before = await this.prisma.aiBillingProvider.findUnique({ where: { id } });
    if (!before) throw new BillingNotFoundError('Provider not found');
    await this.prisma.aiBillingProvider.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      action: 'PROVIDER_DELETED', entityType: 'ai_billing_provider', entityId: id,
      beforeState: this.maskProvider(before),
    });
    return { deleted: true };
  }

  // ── Models ─────────────────────────────────────────────────────────────────

  async listModels(filter?: { providerId?: string; status?: AiBillingModelStatus }) {
    const now = new Date();
    const rows = await this.prisma.aiBillingModel.findMany({
      where: {
        ...(filter?.providerId ? { providerId: filter.providerId } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { modelCode: 'asc' }],
      include: {
        provider: { select: { name: true, kind: true, status: true } },
        // Pricing health for the admin UI: a model without a CURRENTLY
        // effective ACTIVE GLOBAL row will refuse to run for tenants outside
        // a matching PLAN/TENANT override — surface that before it bites.
        pricing: {
          where: {
            status: 'ACTIVE',
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { id: true, scope: true },
        },
      },
    });
    return rows.map(({ pricing, ...model }) => ({
      ...model,
      activePricingCount: pricing.length,
      hasGlobalPricing: pricing.some((row) => row.scope === 'GLOBAL'),
    }));
  }

  async createModel(
    input: { providerId: string; modelCode: string; displayName?: string; maxContext?: number; isDefault?: boolean; status?: AiBillingModelStatus; capabilities?: Record<string, unknown> },
    actor: { id?: string; email?: string; role?: string; ip?: string },
  ) {
    const provider = await this.prisma.aiBillingProvider.findUnique({ where: { id: input.providerId } });
    if (!provider) throw new BillingNotFoundError('Provider not found');
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.aiBillingModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.aiBillingModel.create({
        data: {
          providerId: input.providerId,
          modelCode: input.modelCode.trim(),
          displayName: input.displayName?.trim() || input.modelCode.trim(),
          maxContext: input.maxContext ?? null,
          isDefault: input.isDefault ?? false,
          status: input.status ?? AiBillingModelStatus.ACTIVE,
          capabilities: (input.capabilities ?? {}) as any,
        },
      });
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      action: 'MODEL_CREATED', entityType: 'ai_billing_model', entityId: created.id, afterState: created,
    });
    return created;
  }

  async updateModel(
    id: string,
    input: { displayName?: string; maxContext?: number | null; isDefault?: boolean; status?: AiBillingModelStatus; capabilities?: Record<string, unknown> },
    actor: { id?: string; email?: string; role?: string; ip?: string },
  ) {
    const before = await this.prisma.aiBillingModel.findUnique({ where: { id } });
    if (!before) throw new BillingNotFoundError('Model not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.aiBillingModel.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.aiBillingModel.update({
        where: { id },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
          ...(input.maxContext !== undefined ? { maxContext: input.maxContext } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.capabilities !== undefined ? { capabilities: input.capabilities as any } : {}),
        },
      });
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      action: 'MODEL_UPDATED', entityType: 'ai_billing_model', entityId: id, beforeState: before, afterState: updated,
    });
    return updated;
  }

  async deleteModel(id: string, actor: { id?: string; email?: string; role?: string; ip?: string }) {
    const before = await this.prisma.aiBillingModel.findUnique({ where: { id } });
    if (!before) throw new BillingNotFoundError('Model not found');
    await this.prisma.aiBillingModel.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      action: 'MODEL_DELETED', entityType: 'ai_billing_model', entityId: id, beforeState: before,
    });
    return { deleted: true };
  }

  // ── Execution resolution (failover) ────────────────────────────────────────

  /** True when at least one ACTIVE keyed provider with an ACTIVE model exists. */
  async isCentrallyConfigured(): Promise<boolean> {
    const count = await this.prisma.aiBillingModel.count({
      where: {
        status: AiBillingModelStatus.ACTIVE,
        provider: { status: AiBillingProviderStatus.ACTIVE, apiKeyEncrypted: { not: null } },
      },
    });
    return count > 0;
  }

  /**
   * Pick the execution target: ACTIVE providers in priority order (failover),
   * first one that has the requested model (or, with no request, its default
   * or first ACTIVE model). Decrypts the key — backend use only.
   */
  async resolveExecutionTarget(modelCode?: string | null): Promise<ExecutionTarget | null> {
    const providers = await this.prisma.aiBillingProvider.findMany({
      where: { status: AiBillingProviderStatus.ACTIVE, apiKeyEncrypted: { not: null } },
      orderBy: { priority: 'asc' },
      include: { models: { where: { status: AiBillingModelStatus.ACTIVE } } },
    });
    for (const provider of providers) {
      if (!EXECUTABLE_KINDS.has(provider.kind)) continue;
      const model = modelCode
        ? provider.models.find((m) => m.modelCode === modelCode)
        : provider.models.find((m) => m.isDefault) ?? provider.models[0];
      if (!model) continue;
      return {
        provider: {
          id: provider.id,
          name: provider.name,
          kind: provider.kind,
          apiKey: decryptBillingSecret(provider.apiKeyEncrypted as string, this.key()),
          endpointUrl: provider.endpointUrl,
          organizationId: provider.organizationId,
        },
        model: {
          id: model.id,
          modelCode: model.modelCode,
          displayName: model.displayName,
          maxContext: model.maxContext,
        },
      };
    }
    return null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private encryptKeyFields(apiKey?: string) {
    if (apiKey === undefined) return {};
    const clean = apiKey.trim();
    if (!clean) return {};
    return {
      apiKeyEncrypted: encryptBillingSecret(clean, this.key()),
      apiKeyLast4: clean.slice(-4),
    };
  }

  private key(): Buffer {
    const secret = this.config.get<string>('AI_CONFIG_ENCRYPTION_KEY')
      || this.config.get<string>('JWT_SECRET')
      || '';
    return deriveBillingKey(secret);
  }

  /** Never let key material out of this service. */
  private maskProvider<T extends { apiKeyEncrypted?: string | null; apiKeyLast4?: string | null }>(row: T) {
    const { apiKeyEncrypted, ...rest } = row as any;
    return {
      ...rest,
      hasApiKey: Boolean(apiKeyEncrypted),
      apiKeyFingerprint: apiKeyEncrypted ? createHash('sha256').update(apiKeyEncrypted).digest('hex').slice(0, 12) : null,
    };
  }
}
