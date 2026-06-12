import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM secret envelope — same `v1:` wire format as the legacy tenant
 * AI config encryption so operational tooling treats both alike. The key is
 * derived from the platform encryption secret with a billing-specific context
 * string, so billing secrets cannot be decrypted with the legacy context key.
 */
export function deriveBillingKey(secret: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY or JWT_SECRET (>=32 chars) must be configured for AI billing secrets');
  }
  return createHash('sha256').update(`ai-billing-provider:${secret}`).digest();
}

export function encryptBillingSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptBillingSecret(payload: string, key: Buffer): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('AI billing secret cannot be decrypted (unknown envelope)');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]).toString('utf8');
}
