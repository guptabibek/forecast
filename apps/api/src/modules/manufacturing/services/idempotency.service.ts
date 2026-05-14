import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * IdempotencyService — Exactly-once execution guard for financial operations.
 *
 * Uses a dedicated `idempotency_keys` table with a unique constraint on (scope, key).
 * Callers pass a deterministic key (e.g. "GRN:<grId>") before executing a
 * side-effecting operation. If the key already exists the operation is blocked
 * and the previously-stored result reference is returned.
 *
 * Usage inside a $transaction:
 *   const existing = await this.idempotency.acquire(tx, 'WO_COMPLETE', workOrderId);
 *   if (existing) return existing.resultId;  // already completed
 *   ... perform mutations ...
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  /**
   * Attempt to acquire an idempotency lock within an existing transaction.
   *
   * @param tx        - The Prisma transaction client
   * @param scope     - Logical operation scope, e.g. 'GRN_CONFIRM', 'WO_COMPLETE'
   * @param key       - A unique key within that scope (typically the entity ID)
   * @param tenantId  - Tenant context
   * @returns null if lock acquired (proceed with operation); otherwise the existing record
   */
  async acquire(
    tx: Prisma.TransactionClient,
    scope: string,
    key: string,
    tenantId: string,
  ): Promise<{ resultId: string | null; completedAt: Date } | null> {
    // Check for existing execution
    const existing = await tx.idempotencyKey.findUnique({
      where: {
        tenantId_scope_key: { tenantId, scope, key },
      },
    });

    if (existing) {
      this.logger.warn(
        `Idempotent replay blocked: scope=${scope} key=${key} tenant=${tenantId}`,
      );
      return { resultId: existing.resultId, completedAt: existing.completedAt };
    }

    // Acquire the lock by inserting
    try {
      await tx.idempotencyKey.create({
        data: {
          tenantId,
          scope,
          key,
          completedAt: new Date(),
        },
      });
    } catch (error: unknown) {
      // P2002 = unique constraint violation — concurrent insert race
      if (
        error instanceof Object &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `Operation ${scope}:${key} is already being processed. Please retry.`,
        );
      }
      throw error;
    }

    return null; // lock acquired — caller should proceed
  }

  /**
   * Stamp the result ID on a previously acquired idempotency record.
   * Called after the operation completes successfully within the same transaction.
   */
  async stamp(
    tx: Prisma.TransactionClient,
    scope: string,
    key: string,
    tenantId: string,
    resultId: string,
  ): Promise<void> {
    await tx.idempotencyKey.update({
      where: {
        tenantId_scope_key: { tenantId, scope, key },
      },
      data: { resultId },
    });
  }
}
