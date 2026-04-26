import { GPMClient, type GPMProfile } from '@app/gpm-client';
import { createLogger, loadEnv } from '@app/shared';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';

const log = createLogger('profile-sync');
const env = loadEnv();

/**
 * Pull toàn bộ profile từ GPM Login → upsert vào DB.
 * Idempotent: gọi lại sẽ refresh metadata, không tạo trùng.
 */
export async function syncProfilesFromGpm(): Promise<{ total: number; upserted: number }> {
  const gpm = new GPMClient({
    baseUrl: env.GPM_ENDPOINT,
    prefix: env.GPM_API_PREFIX,
    apiKey: env.GPM_API_KEY,
  });

  let page = 1;
  const perPage = 100;
  let upserted = 0;
  let total = 0;

  while (true) {
    const res = await gpm.listProfiles({ page, perPage });
    total = res.total;
    if (res.items.length === 0) break;

    const rows = res.items.map((p: GPMProfile) => ({
      id: p.id,
      name: p.name,
      browserType: p.browser?.name ?? null,
      browserVersion: p.browser?.version ?? null,
      groupId: p.group_id,
      rawProxy: p.raw_proxy || null,
    }));

    await db
      .insert(profiles)
      .values(rows)
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          name: drizzleSql`excluded.name`,
          browserType: drizzleSql`excluded.browser_type`,
          browserVersion: drizzleSql`excluded.browser_version`,
          groupId: drizzleSql`excluded.group_id`,
          rawProxy: drizzleSql`excluded.raw_proxy`,
          syncedAt: drizzleSql`now()`,
        },
      });

    upserted += rows.length;
    if (page >= res.lastPage) break;
    page += 1;
  }

  log.info({ total, upserted }, 'Profile sync done');
  return { total, upserted };
}
