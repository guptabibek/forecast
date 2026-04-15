import { createDecipheriv } from 'crypto';
import { inflateRawSync } from 'zlib';

/**
 * Decrypt Marg EDE API response payload.
 *
 * Marg uses AES-128-ECB with PKCS7 padding.
 * The decryption key provided is typically 12 characters;
 * it is right-padded with null bytes to 16 bytes (128 bits).
 */
export function decryptMargPayload(
  encryptedBase64: string,
  decryptionKey: string,
): string {
  // Pad or trim key to 16 bytes for AES-128
  const keyBuffer = Buffer.alloc(16, 0);
  Buffer.from(decryptionKey, 'utf8').copy(keyBuffer);

  const decipher = createDecipheriv('aes-128-ecb', keyBuffer, null);
  decipher.setAutoPadding(true);

  const encrypted = Buffer.from(encryptedBase64, 'base64');
  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Decrypt Marg EDE payload when endpoint returns raw encrypted string.
 *
 * Observed response flow:
 * 1) AES-128-CBC decryption (key and IV use the same 16-byte padded key)
 * 2) base64 decode + raw-deflate inflate
 */
export function decryptMargCompressedPayload(
  encryptedBase64: string,
  decryptionKey: string,
): string {
  const keyBuffer = Buffer.alloc(16, 0);
  Buffer.from(decryptionKey, 'utf8').copy(keyBuffer);

  const decipher = createDecipheriv('aes-128-cbc', keyBuffer, keyBuffer);
  decipher.setAutoPadding(true);

  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decryptedCompressedB64 = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');

  const inflated = inflateRawSync(Buffer.from(decryptedCompressedB64, 'base64')).toString('utf8');

  // Marg payloads can include UTF-8 BOM; JSON.parse cannot consume it.
  return inflated.replace(/^\uFEFF/, '');
}
