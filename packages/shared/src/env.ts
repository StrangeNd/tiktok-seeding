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
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // ─── Master ───
  MASTER_PORT: z.coerce.number().int().min(1).max(65535).default(7000),
  MASTER_API_KEY: z.string().min(8).default('dev-key-change-me'),

  // ─── Database ───
  DATABASE_URL: z.string().url(),

  // ─── Queue ───
  REDIS_URL: z.string().url(),

  // ─── GPM Login Global API (Phase 0 verified) ───
  GPM_ENDPOINT: z.string().url().default('http://127.0.0.1:9495'),
  GPM_API_PREFIX: z.string().default('/api/v1'),
  GPM_API_KEY: z.string().optional(),

  // ─── Worker ───
  WORKER_NAME: z.string().default('worker-local'),
  CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

/**
 * Load và validate environment một lần (memoize).
 * Throw process.exit(1) nếu env không hợp lệ.
 */
export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // biome-ignore lint/suspicious/noConsole: bootstrap, logger chưa sẵn sàng
    console.error('✗ Invalid environment variables:');
    // biome-ignore lint/suspicious/noConsole: bootstrap
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
