import { createLogger } from '@app/shared';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../db/client.js';

const log = createLogger('recovery');

export interface ResetResult {
  released: number;
  ids: string[];
}

/**
 * Release profiles stuck in `in_use` whose linked jobs are all in terminal state.
 *
 * Safe to call:
 *   - on master startup (recover from previous crash)
 *   - on demand via /admin/reset-stuck-profiles
 *
 * Invariant: a profile is legitimately `in_use` IFF at least one linked job is
 * in {pending, running, retrying}. Anything else is leftover from a crash.
 *
 * Importantly this is safe even if a worker is currently processing a job —
 * that job's row will be `running`, so its profile will NOT be released.
 */
export async function resetStuckProfiles(): Promise<ResetResult> {
  const rows = await db.execute<{ id: string }>(drizzleSql`
    UPDATE profiles
    SET status = 'available'
    WHERE status = 'in_use'
      AND id NOT IN (
        SELECT DISTINCT profile_id
        FROM jobs
        WHERE status IN ('pending', 'running', 'retrying')
      )
    RETURNING id
  `);

  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    log.warn({ count: ids.length, ids }, 'Released stuck in_use profiles');
  }
  return { released: ids.length, ids };
}
