// benchmark.mjs — Mở N profile concurrent, đo thời gian + RAM/CPU.
// Mục đích: verify máy chịu được 60 tab cùng lúc thật sự.
//
// Usage:
//   node benchmark.mjs --count=10 --url=https://www.tiktok.com/foryou --hold=60
//   node benchmark.mjs --count=60 --hold=120 --rampUpMs=500
//
// Lưu ý:
//   - Cần đủ profile trong GPM (script chỉ dùng N profile đầu tiên từ list).
//   - Chạy thử --count nhỏ trước (5, 10) rồi tăng dần.

import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { discoverGPM, GPMClient, resolveWsEndpoint } from './gpm.mjs';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}
const args = parseArgs();
const COUNT = Number(args.count ?? 10);
const URL = args.url || 'https://www.tiktok.com/foryou';
const HOLD_SEC = Number(args.hold ?? 60);
const RAMP_MS = Number(args.rampUpMs ?? 800); // delay giữa các profile để khỏi bóp CPU
const apiKey = args.apiKey || process.env.GPM_API_KEY;

console.log(`▶ Benchmark: count=${COUNT}, hold=${HOLD_SEC}s, rampUp=${RAMP_MS}ms/profile`);

const found = await discoverGPM({ apiKey, ports: args.port ? [Number(args.port)] : undefined });
if (!found) {
  console.error('✗ Không tìm thấy GPMLogin Global API. Chạy `node discover.mjs --port=<port>` trước.');
  process.exit(1);
}
console.log(`✓ GPM endpoint: ${found.baseUrl} (${found.sender ?? 'unknown version'})`);
const gpm = new GPMClient({ baseUrl: found.baseUrl, prefix: found.prefix, apiKey });

console.log('▶ Lấy danh sách profile...');
// Lấy toàn bộ pool (mức dự kiến ~103) để có thể shuffle
const list = await gpm.listProfiles({ perPage: 200, groupId: args.groupId });
const items = list.items;
const total = list.total;
// Shuffle để tránh đụng profile khi chạy benchmark liên tiếp (GPM giữ flag InUse vài s)
for (let i = items.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}
const ids = items.slice(0, COUNT).map(p => p.id).filter(Boolean);

if (ids.length < COUNT) {
  console.error(`⚠  Chỉ có ${ids.length}/${COUNT} profile khả dụng (tổng pool: ${total}).`);
  if (ids.length === 0) {
    console.error('  Tạo profile trong GPM Login app trước khi benchmark.');
    process.exit(2);
  }
  console.error(`  Sẽ chỉ chạy ${ids.length} profile thay vì ${COUNT}.`);
}
console.log(`✓ Sẽ chạy ${ids.length} profile (pool có ${total})`);

const results = [];
const startTimes = new Map();
const browsers = new Map();

function memUsageMB() {
  const free = os.freemem() / 1048576;
  const total = os.totalmem() / 1048576;
  return { used: Math.round(total - free), total: Math.round(total) };
}

const memBaseline = memUsageMB().used;
let memPeak = memBaseline;
let memPeakActiveCount = 0;

const monitor = setInterval(() => {
  const m = memUsageMB();
  if (m.used > memPeak) {
    memPeak = m.used;
    memPeakActiveCount = browsers.size;
  }
  console.log(`  [monitor] RAM ${m.used}/${m.total} MB | active browsers: ${browsers.size}`);
}, 5000);

async function spawnOne(id, idx) {
  const t0 = Date.now();
  let started = null;
  try {
    started = await gpm.startProfile(id);
    const browser = await puppeteer.connect({ browserWSEndpoint: started.wsEndpoint, defaultViewport: null });
    browsers.set(id, browser);
    const tConnect = Date.now() - t0;

    let page = (await browser.pages())[0];
    if (!page) page = await browser.newPage();

    const tNav0 = Date.now();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const tNav = Date.now() - tNav0;

    results.push({ id, idx, ok: true, tConnect, tNav });
    console.log(`  [#${idx + 1}/${ids.length}] ${id} ok — connect ${tConnect}ms, nav ${tNav}ms`);
  } catch (err) {
    results.push({ id, idx, ok: false, error: err.message });
    console.log(`  [#${idx + 1}/${ids.length}] ${id} FAIL — ${err.message}`);
    // Auto-cleanup: nếu profile đã start nhưng fail sau đó, đóng để không leak browser
    if (started && !browsers.has(id)) {
      await gpm.closeProfile(id).catch(() => {});
    }
  }
}

const tBenchStart = Date.now();
console.log('▶ Spawning profiles (ramp-up)...');
const tasks = [];
for (let i = 0; i < ids.length; i++) {
  tasks.push(spawnOne(ids[i], i));
  await new Promise(r => setTimeout(r, RAMP_MS));
}
await Promise.all(tasks);
const tSpawnDone = Date.now() - tBenchStart;
console.log(`✓ Spawn xong sau ${tSpawnDone} ms`);

const memAfterSpawn = memUsageMB();
console.log(`  RAM sau spawn: ${memAfterSpawn.used}/${memAfterSpawn.total} MB`);

console.log(`▶ Hold ${HOLD_SEC}s để mô phỏng watch live...`);
await new Promise(r => setTimeout(r, HOLD_SEC * 1000));

clearInterval(monitor);

console.log('▶ Cleanup...');
for (const [id, browser] of browsers.entries()) {
  try { await browser.disconnect(); } catch {}
  try { await gpm.closeProfile(id); } catch {}
}

const ok = results.filter(r => r.ok).length;
const fail = results.length - ok;
const avgConnect = Math.round(results.filter(r => r.ok).reduce((s, r) => s + r.tConnect, 0) / Math.max(ok, 1));
const avgNav = Math.round(results.filter(r => r.ok).reduce((s, r) => s + r.tNav, 0) / Math.max(ok, 1));
const memNow = memUsageMB();

// RAM/profile thực = (peak trong lúc hold - baseline trước khi spawn) / số browser active lúc peak
const ramDelta = Math.max(memPeak - memBaseline, 0);
const ramPerProfile = Math.round(ramDelta / Math.max(memPeakActiveCount || ok, 1));
const successRate = Math.round((ok / Math.max(results.length, 1)) * 100);
const inUseFails = results.filter(r => !r.ok && /ProfileInUse/i.test(r.error)).length;

console.log('\n══════ KẾT QUẢ BENCHMARK ══════');
console.log(`  Profile mở thành công:  ${ok}/${results.length}  (${successRate}%)`);
console.log(`  Profile lỗi:            ${fail}` + (inUseFails ? `  (trong đó ${inUseFails} ProfileInUse — vẫn đang bị GPM khóa)` : ''));
console.log(`  Avg connect time:       ${avgConnect} ms`);
console.log(`  Avg nav time:           ${avgNav} ms`);
console.log(`  Tổng spawn time:        ${tSpawnDone} ms`);
console.log(`  RAM baseline:           ${memBaseline} MB (trước khi spawn)`);
console.log(`  RAM peak:               ${memPeak} MB (lúc peak có ${memPeakActiveCount} browser hoạt động)`);
console.log(`  RAM hiện tại (sau dọn): ${memNow.used}/${memNow.total} MB`);
console.log(`  CPU cores:              ${os.cpus().length}`);
console.log(`  RAM/profile thực:       ${ramPerProfile} MB  ← dùng số này tính concurrency thật của máy`);
console.log('═══════════════════════════════');

if (fail > 0) {
  console.log('\nLỗi (top 5):');
  results.filter(r => !r.ok).slice(0, 5).forEach(r => console.log(`  - ${r.id}: ${r.error}`));
}
