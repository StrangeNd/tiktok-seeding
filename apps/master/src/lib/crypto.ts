// AES-256-GCM helpers for at-rest encryption of account/proxy secret blobs.
//
// Format (base64-encoded, single string):
//   v1.<iv_b64>.<authTag_b64>.<ciphertext_b64>
//
// Key derivation: SHA-256 over CREDENTIALS_ENCRYPTION_KEY -> 32 bytes.
// This is intentionally simple. For production with multi-tenant secrets,
// rotate to a KMS-backed envelope-encryption scheme.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@app/shared';

const env = loadEnv();

const KEY = createHash('sha256').update(env.CREDENTIALS_ENCRYPTION_KEY, 'utf8').digest();
const ALG = 'aes-256-gcm';

export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptString(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('encryption_blob_invalid_format');
  }
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const ct = Buffer.from(parts[3] ?? '', 'base64');
  const decipher = createDecipheriv(ALG, KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}

export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T = unknown>(blob: string): T {
  return JSON.parse(decryptString(blob)) as T;
}

/** Mask a secret for safe display (keep first 2 + last 2 chars). */
export function maskSecret(s: string | null | undefined): string {
  if (!s) return '';
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}
