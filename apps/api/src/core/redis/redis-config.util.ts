import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

export function isRedisConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REDIS_URL?.trim() || env.REDIS_HOST?.trim());
}

export function resolveRedisOptions(configService: ConfigService): RedisOptions {
  const redisUrl = configService.get<string>('REDIS_URL')?.trim();
  if (redisUrl) {
    const parsed = new URL(redisUrl);
    const parsedPort = parsed.port ? Number(parsed.port) : 6379;
    const dbSegment = parsed.pathname.replace(/^\//, '');
    const parsedDb = dbSegment ? Number(dbSegment) : undefined;

    return {
      host: parsed.hostname,
      port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      db: parsedDb !== undefined && Number.isInteger(parsedDb) && parsedDb >= 0 ? parsedDb : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  }

  return {
    host: configService.get<string>('REDIS_HOST', 'localhost'),
    port: configService.get<number>('REDIS_PORT', 6379),
    password: configService.get<string>('REDIS_PASSWORD') || undefined,
  };
}