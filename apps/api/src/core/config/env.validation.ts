type RawEnv = Record<string, string | undefined>;

type ValidatedEnv = Record<string, string | number>;

const PLACEHOLDER_PATTERNS = [/^your-/i, /^change_me/i, /^sk-your-/i];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function requireString(env: RawEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Environment validation failed: ${key} is required`);
  }
  return value;
}

function parsePort(env: RawEnv, key: string, fallback?: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment validation failed: ${key} is required`);
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Environment validation failed: ${key} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function parseBooleanFlag(env: RawEnv, key: string, fallback = false): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;

  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;

  throw new Error(`Environment validation failed: ${key} must be a boolean (true/false)`);
}

function assertMinLength(name: string, value: string, minLength: number) {
  if (value.length < minLength) {
    throw new Error(`Environment validation failed: ${name} must be at least ${minLength} characters`);
  }
}

function assertNoPlaceholderInProd(name: string, value: string, nodeEnv: string) {
  if (nodeEnv === 'production' && isPlaceholder(value)) {
    throw new Error(`Environment validation failed: ${name} contains a placeholder value in production`);
  }
}

function normalizeNodeEnv(value?: string): string {
  const env = (value || 'development').trim();
  const allowed = new Set(['development', 'test', 'production']);
  if (!allowed.has(env)) {
    throw new Error('Environment validation failed: NODE_ENV must be one of development, test, production');
  }
  return env;
}

export function validateEnv(env: RawEnv): ValidatedEnv {
  const nodeEnv = normalizeNodeEnv(env.NODE_ENV);

  const databaseUrl = requireString(env, 'DATABASE_URL');
  const jwtSecret = requireString(env, 'JWT_SECRET');
  const jwtRefreshSecret = requireString(env, 'JWT_REFRESH_SECRET');
  assertMinLength('JWT_SECRET', jwtSecret, 32);
  assertMinLength('JWT_REFRESH_SECRET', jwtRefreshSecret, 32);

  assertNoPlaceholderInProd('JWT_SECRET', jwtSecret, nodeEnv);
  assertNoPlaceholderInProd('JWT_REFRESH_SECRET', jwtRefreshSecret, nodeEnv);
  assertNoPlaceholderInProd('DATABASE_URL', databaseUrl, nodeEnv);

  const mainDomain = (env.MAIN_DOMAIN || '').trim();
  if (nodeEnv === 'production' && !mainDomain) {
    throw new Error('Environment validation failed: MAIN_DOMAIN is required in production');
  }

  const apiPort = parsePort(env, 'API_PORT', 3000);
  const redisPort = env.REDIS_PORT ? parsePort(env, 'REDIS_PORT', 6379) : 6379;
  const refreshTokenDays = Number(env.REFRESH_TOKEN_DAYS || 7);
  if (!Number.isInteger(refreshTokenDays) || refreshTokenDays < 1 || refreshTokenDays > 90) {
    throw new Error('Environment validation failed: REFRESH_TOKEN_DAYS must be an integer between 1 and 90');
  }

  return {
    ...env,
    NODE_ENV: nodeEnv,
    DATABASE_URL: databaseUrl,
    MAIN_DOMAIN: mainDomain,
    JWT_SECRET: jwtSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    API_PORT: apiPort,
    REDIS_URL: env.REDIS_URL?.trim() || '',
    REDIS_HOST: env.REDIS_HOST?.trim() || '',
    REDIS_PORT: redisPort,
    REDIS_PASSWORD: env.REDIS_PASSWORD?.trim() || '',
    REFRESH_TOKEN_DAYS: refreshTokenDays,
  };
}
