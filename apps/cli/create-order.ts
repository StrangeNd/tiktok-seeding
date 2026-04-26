// Tạo 1 order live_view test.
// Usage: pnpm --filter @app/cli run create-order -- --url=https://www.tiktok.com/foryou --count=5 --watch=60

import { masterFetch } from './_master.js';

function parseArgs() {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      // --key=value
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      // --key [value] (peek next arg, only if it's not another flag)
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

const args = parseArgs();
const url = args.url;
const count = Number(args.count ?? 5);
const watch = Number(args.watch ?? 60);
const spread = Number(args.spread ?? 0);

if (!url) {
  console.error('Thiếu --url=<tiktok-url>');
  console.error('Vd: --url=https://www.tiktok.com/foryou --count=5 --watch=60 --spread=10');
  process.exit(1);
}

const r = await masterFetch('/orders', {
  method: 'POST',
  body: JSON.stringify({
    type: 'live_view',
    targetUrl: url,
    count,
    watchSeconds: watch,
    spreadSeconds: spread,
  }),
});
const data = (await r.json()) as {
  orderId: number;
  jobIds: number[];
  leasedProfiles: number;
  shortage: number;
};
console.log('✓ Order created');
console.log(`  Order ID:           ${data.orderId}`);
console.log(`  Jobs spawned:       ${data.jobIds.length}`);
console.log(`  Profile leased:     ${data.leasedProfiles}`);
if (data.shortage > 0) {
  console.log(`  ⚠  Thiếu profile:    ${data.shortage} (cần sync hoặc chờ release)`);
}
console.log(`\nXem chi tiết: pnpm --filter @app/cli run list-orders -- --id=${data.orderId}`);
