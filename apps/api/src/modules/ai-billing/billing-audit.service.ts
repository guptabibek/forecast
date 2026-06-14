import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';

export interface BillingAuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  tenantId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
}

/**
 * Immutable audit trail for every sensitive billing action. Rows can never be
 * updated or deleted (DB trigger). Recording is best-effort by design for
 * read paths, but financial mutations call `record` INSIDE their transaction
 * via `recordIn` so the audit row commits atomically with the change.
 */
@Injectable()
export class BillingAuditService {
  private readonly logger = new Logger(BillingAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget variant for non-transactional contexts. */
  async record(entry: BillingAuditEntry): Promise<void> {
    try {
      await this.recordIn(this.prisma, entry);
    } catch (error: any) {
      this.logger.error(`Billing audit write failed for ${entry.action}: ${String(error?.message ?? error)}`);
    }
  }

  /** Transactional variant — pass the Prisma transaction client. */
  async recordIn(
    client: Pick<PrismaService, 'aiBillingAuditLog'>,
    entry: BillingAuditEntry,
  ): Promise<void> {
    await client.aiBillingAuditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail?.slice(0, 255) ?? null,
        actorRole: entry.actorRole?.slice(0, 40) ?? null,
        tenantId: entry.tenantId ?? null,
        action: entry.action.slice(0, 80),
        entityType: entry.entityType.slice(0, 60),
        entityId: entry.entityId ? String(entry.entityId).slice(0, 64) : null,
        beforeState: this.safeJson(entry.beforeState),
        afterState: this.safeJson(entry.afterState),
        reason: entry.reason?.slice(0, 2000) ?? null,
        ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
      },
    });
  }

  async list(filter: { tenantId?: string; entityType?: string; action?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where = {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.action ? { action: filter.action } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.aiBillingAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiBillingAuditLog.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  /**
   * Secrets must never reach the audit trail: any key that looks like a
   * credential is masked before serialization.
   */
  private safeJson(value: unknown): any {
    if (value === undefined || value === null) return undefined;
    try {
      return JSON.parse(JSON.stringify(value, (key, val) => {
        if (/apikey|api_key|secret|password|token/i.test(key) && typeof val === 'string') {
          return `***${val.slice(-4)}`;
        }
        return val;
      }));
    } catch {
      return { unserializable: true };
    }
  }
}
