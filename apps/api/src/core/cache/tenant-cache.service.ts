import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { isRedisConfigured, resolveRedisOptions } from '../redis/redis-config.util';

/**
 * Tenant-scoped Redis cache service.
 * All keys are automatically namespaced with tenant ID to prevent cross-tenant cache pollution.
 *
 * Key format: tenant:{tenantId}:{namespace}:{key}
 *
 * Falls back gracefully when Redis is unavailable — cache misses simply
 * cause a DB query, so the application never fails due to cache issues.
 */
@Injectable()
export class TenantCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantCacheService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (!isRedisConfigured()) {
      this.logger.log('REDIS_URL not configured — running without cache');
      return;
    }

    try {
      this.client = new Redis({
        ...resolveRedisOptions(this.configService),
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 5) return null; // Stop retrying after 5 attempts
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
        keyPrefix: 'fh:', // forecasthub namespace
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Redis cache connected');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis cache error: ${err.message}`);
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (err) {
      this.logger.warn(`Redis cache unavailable, operating without cache: ${err.message}`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }

  /**
   * Build a tenant-scoped cache key
   */
  private buildKey(tenantId: string, namespace: string, key: string): string {
    return `tenant:${tenantId}:${namespace}:${key}`;
  }

  /**
   * Get a value from the tenant-scoped cache
   */
  async get<T = unknown>(tenantId: string, namespace: string, key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) return null;

    try {
      const value = await this.client.get(this.buildKey(tenantId, namespace, key));
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set a value in the tenant-scoped cache
   * @param ttlSeconds Time-to-live in seconds (default: 300 = 5 minutes)
   */
  async set(
    tenantId: string,
    namespace: string,
    key: string,
    value: unknown,
    ttlSeconds = 300,
  ): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      const serialized = JSON.stringify(value);
      await this.client.set(this.buildKey(tenantId, namespace, key), serialized, 'EX', ttlSeconds);
    } catch {
      // Cache write failure is non-fatal
    }
  }

  /**
   * Delete a specific key from the tenant-scoped cache
   */
  async del(tenantId: string, namespace: string, key: string): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      await this.client.del(this.buildKey(tenantId, namespace, key));
    } catch {
      // Cache delete failure is non-fatal
    }
  }

  /**
   * Invalidate all cache entries for a tenant within a namespace.
   * Uses SCAN to find matching keys (safe for production, non-blocking).
   */
  async invalidateNamespace(tenantId: string, namespace: string): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      const pattern = `fh:tenant:${tenantId}:${namespace}:*`;
      let cursor = '0';
      do {
        const [newCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = newCursor;
        if (keys.length > 0) {
          // Strip the keyPrefix since ioredis auto-prepends it
          const unprefixedKeys = keys.map((k) => k.replace(/^fh:/, ''));
          await this.client.del(...unprefixedKeys);
        }
      } while (cursor !== '0');
    } catch {
      // Namespace invalidation failure is non-fatal
    }
  }

  /**
   * Invalidate ALL cache entries for a tenant (e.g., on tenant deletion or suspension).
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      const pattern = `fh:tenant:${tenantId}:*`;
      let cursor = '0';
      do {
        const [newCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = newCursor;
        if (keys.length > 0) {
          const unprefixedKeys = keys.map((k) => k.replace(/^fh:/, ''));
          await this.client.del(...unprefixedKeys);
        }
      } while (cursor !== '0');
    } catch {
      // Tenant invalidation failure is non-fatal
    }
  }

  /**
   * Get-or-set pattern: returns cached value if present, otherwise calls factory
   * and caches the result.
   */
  async getOrSet<T>(
    tenantId: string,
    namespace: string,
    key: string,
    factory: () => Promise<T>,
    ttlSeconds = 300,
  ): Promise<T> {
    const cached = await this.get<T>(tenantId, namespace, key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(tenantId, namespace, key, value, ttlSeconds);
    return value;
  }

  /**
   * Health check for the Redis connection
   */
  async isHealthy(): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;

    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
