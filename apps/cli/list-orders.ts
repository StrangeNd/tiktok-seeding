// Liệt kê order hoặc xem chi tiết 1 order.
// Usage:
//   pnpm --filter @app/cli run list-orders             → list mới nhất
//   pnpm --filter @app/cli run list-orders -- --id=42  → chi tiết order 42

import { masterFetch } from './_master.js';

interface OrderRow {
  id: number;
  type: string;
  targetUrl: string;
  count: number;
  watchSeconds: number;
  status: string;
  completedJobs: number;
  failedJobs: number;
  createdAt: string;
}
interface JobRow {
  id: number;
  status: string;
  profileId: string;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

const args: Record<string, string> = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = 'true';
      }
    }
  }
}

if (args.id) {
  const r = await masterFetch(`/orders/${args.id}`);
  const data = (await r.json()) as { order: OrderRow; jobs: JobRow[] };
  const o = data.order;
  console.log(
    `Order #${o.id} — ${o.status} — ${o.completedJobs}/${o.count} done, ${o.failedJobs} fail`,
  );
  console.log(`  type:     ${o.type}`);
  console.log(`  url:      ${o.targetUrl}`);
  console.log(`  watch:    ${o.watchSeconds}s`);
  console.log(`  created:  ${o.createdAt}`);
  console.log('');
  console.log('  Job# | Status      | Profile (8)     | Att | Dur(s) | Error');
  console.log('  -----+-------------+-----------------+-----+--------+--------------');
  for (const j of data.jobs) {
    const dur = j.durationMs ? (j.durationMs / 1000).toFixed(1) : '-';
    const err = j.errorCode ? `${j.errorCode}: ${(j.errorMessage ?? '').slice(0, 40)}` : '';
    console.log(
      `  ${String(j.id).padStart(4)} | ${j.status.padEnd(11)} | ${j.profileId.slice(0, 8).padEnd(15)} | ${String(j.attempt).padStart(3)} | ${dur.padStart(6)} | ${err}`,
    );
  }
} else {
  const r = await masterFetch('/orders');
  const data = (await r.json()) as { orders: OrderRow[] };
  console.log('  ID  | Status   | Type       | Done/Total | Fail | URL');
  console.log('  ----+----------+------------+------------+------+----------------------------');
  for (const o of data.orders) {
    console.log(
      `  ${String(o.id).padStart(3)} | ${o.status.padEnd(8)} | ${o.type.padEnd(10)} | ${String(o.completedJobs).padStart(4)}/${String(o.count).padStart(4)}  | ${String(o.failedJobs).padStart(4)} | ${o.targetUrl.slice(0, 60)}`,
    );
  }
}
