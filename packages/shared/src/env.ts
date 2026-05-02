import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Auto-load .env từ workspace root.
 * Lookup upward từ vị trí file này (packages/shared/src/env.ts) → tìm `.env` ở bất kỳ ancestor.
 * Idempotent: dotenv.config() không override env đã set.
 */
function autoLoadDotenv(): void {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

autoLoadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ─── Master ───
  MASTER_PORT: z.coerce.number().int().min(1).max(65535).default(7000),
  MASTER_API_KEY: z.string().min(8).default('dev-key-change-me'),
  /** Base URL for worker → master communication. Default derives from MASTER_PORT. */
  MASTER_URL: z.string().url().optional(),

  // ─── Database ───
  DATABASE_URL: z.string().url(),

  // ─── Queue ───
  REDIS_URL: z.string().url(),

  // ─── GPM Login Global API (Phase 0 verified) ───
  GPM_MODE: z.enum(['live', 'mock']).default('live'),
  GPM_ENDPOINT: z.string().url().default('http://127.0.0.1:9495'),
  GPM_API_PREFIX: z.string().default('/api/v1'),
  GPM_API_KEY: z.string().optional(),

  // ─── Worker ───
  WORKER_NAME: z.string().default('worker-local'),
  CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),

  // ─── Dashboard ───
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(5173),

  // ─── Secrets / sensitive storage ───
  // Used to AES-256-GCM encrypt account/proxy secret blobs at rest.
  // MUST be >= 32 chars in production. Default is dev-only and unsafe.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(16)
    .default('dev-credentials-key-change-me-please-32+ch'),

  // Neutral connectivity-test endpoint for proxy validation. Default is a
  // platform-agnostic public IP echo (no TikTok). Operators can override.
  PROXY_TEST_URL: z.string().url().default('https://api.ipify.org?format=text'),
  PROXY_TEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(8000),

  // ─── Mail code retrieval (owned-account inboxes only) ───
  MAIL_PROVIDER: z.enum(['microsoft', 'gmail', 'custom']).default('custom'),
  MAIL_CODE_LOOKBACK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  MAIL_CODE_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(10),
  MAIL_CODE_ALLOWED_SENDERS: z.string().optional(),
  MAIL_CODE_SUBJECT_HINTS: z.string().optional(),
  MAIL_CODE_REQUEST_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(300).default(30),

  AUTH_SESSION_SECRET: z.string().min(16).default('dev-auth-session-secret-change-me-32+ch'),
  AUTH_ALLOW_SELF_REGISTER: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  AUTH_REQUIRE_ADMIN_APPROVAL: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  USER_CAN_IMPORT_PROXIES: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type AppEnv = z.infer<typeof envSchema>;

const DEFAULT_MASTER_API_KEY = 'dev-key-change-me';
const DEFAULT_CREDENTIALS_ENCRYPTION_KEY = 'dev-credentials-key-change-me-please-32+ch';
const DEFAULT_AUTH_SESSION_SECRET = 'dev-auth-session-secret-change-me-32+ch';

let cached: AppEnv | null = null;

/**
 * Load và validate environment một lần (memoize).
 * Throw process.exit(1) nếu env không hợp lệ.
 */
export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('✗ Invalid environment variables:');
    console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Reset env cache (dùng cho test hoặc khi cần reload).
 */
export function _resetEnvCache(): void {
  cached = null;
}

export function getConfigWarnings(env: AppEnv): string[] {
  const warnings: string[] = [];
  if (env.MASTER_API_KEY === DEFAULT_MASTER_API_KEY) {
    warnings.push('MASTER_API_KEY is using the default development value');
  }
  if (
    env.CREDENTIALS_ENCRYPTION_KEY === DEFAULT_CREDENTIALS_ENCRYPTION_KEY ||
    env.CREDENTIALS_ENCRYPTION_KEY.length < 32
  ) {
    warnings.push('CREDENTIALS_ENCRYPTION_KEY is default or shorter than 32 characters');
  }
  if (
    env.NODE_ENV === 'production' &&
    (env.MASTER_API_KEY === DEFAULT_MASTER_API_KEY ||
      env.CREDENTIALS_ENCRYPTION_KEY === DEFAULT_CREDENTIALS_ENCRYPTION_KEY ||
      env.AUTH_SESSION_SECRET === DEFAULT_AUTH_SESSION_SECRET ||
      env.CREDENTIALS_ENCRYPTION_KEY.length < 32)
  ) {
    warnings.push('NODE_ENV=production is running with unsafe operator secrets');
  }
  if (
    env.AUTH_SESSION_SECRET === DEFAULT_AUTH_SESSION_SECRET ||
    env.AUTH_SESSION_SECRET.length < 32
  ) {
    warnings.push('AUTH_SESSION_SECRET is default or shorter than 32 characters');
  }
  return warnings;
}
