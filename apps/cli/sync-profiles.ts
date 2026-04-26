// Pull toàn bộ GPM profile vào DB master.
// Usage: pnpm --filter @app/cli run sync-profiles

import { masterFetch } from './_master.js';

const r = await masterFetch('/admin/sync-profiles', { method: 'POST' });
const data = (await r.json()) as { total: number; upserted: number };
console.log('✓ Sync profile xong');
console.log(`  Tổng pool GPM: ${data.total}`);
console.log(`  Upserted vào DB: ${data.upserted}`);
