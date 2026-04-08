import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const logger = new Logger('RetryUtility');

/**
 * Enterprise retry wrapper with exponential backoff + jitter.
 * Used for optimistic-lock conflicts on cost layers, item costs, and revaluation.
 *
 * Retries on:
 * - NestJS ConflictException (optimistic lock failures)
 * - Prisma P2034 (write conflict / deadlock in interactive transactions)
 * - Messages containing 'concurrently modified' or 'was modified by another'
 *
 * Features:
 * - Preserves idempotency (same tx context, same idempotency key)
 * - Exponential backoff with random jitter to avoid thundering herd
 * - Max 5 retries (configurable)
 * - Throws domain exception on exhaustion
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    baseDelayMs?: number;
    operationName?: string;
  },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 5;
  const baseDelay = opts?.baseDelayMs ?? 50;
  const opName = opts?.operationName ?? 'operation';

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isConflict =
        error instanceof ConflictException ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') ||
        (error instanceof Error && error.message?.includes('concurrently modified')) ||
        (error instanceof Error && error.message?.includes('was modified by another'));

      if (!isConflict || attempt >= maxRetries) {
        throw error;
      }

      lastError = error as Error;
      // Exponential backoff with random jitter (0.5x–1.5x) to prevent thundering herd
      const delay = baseDelay * Math.pow(2, attempt) * (0.5 + Math.random());
      logger.warn(
        `Retry ${attempt + 1}/${maxRetries} for ${opName} after conflict: ${lastError.message}. ` +
        `Backing off ${Math.round(delay)}ms.`,
      );
      await sleep(delay);
    }
  }

  // Unreachable: loop always exits via return or throw, but satisfies TypeScript
  throw lastError ?? new ConflictException(`${opName} failed after ${maxRetries} retries`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
