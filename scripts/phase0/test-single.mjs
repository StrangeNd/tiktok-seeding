// test-single.mjs — Start 1 profile, connect Puppeteer qua CDP, mở TikTok kiểm tra.
// Usage:
//   node test-single.mjs --profileId=abc-xyz
//   node test-single.mjs --profileId=abc-xyz --url=https://www.tiktok.com/foryou
//   node test-single.mjs --profileId=abc-xyz --keepOpen=30   (giữ mở 30s rồi đóng)

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
const apiKey = args.apiKey || process.env.GPM_API_KEY;
const profileId = args.profileId;
const url = args.url || 'https://www.tiktok.com/';
const keepOpen = Number(args.keepOpen ?? 15);

if (!profileId) {
  console.error('Cần --profileId=<id>. Chạy `node discover.mjs` để xem danh sách profile.');
  process.exit(1);
}

console.log('▶ Discover GPM...');
const found = await discoverGPM({ apiKey, ports: args.port ? [Number(args.port)] : undefined });
if (!found) { console.error('GPM Runtime không phản hồi'); process.exit(1); }
const gpm = new GPMClient({ baseUrl: found.baseUrl, prefix: found.prefix, apiKey });

console.log(`▶ Start profile ${profileId}...`);
const t0 = Date.now();
const started = await gpm.startProfile(profileId);
console.log(`  port: ${started.port}, pid: ${started.processId}, name: ${started.profileName}`);
console.log(`  wsEndpoint: ${started.wsEndpoint}`);

console.log('▶ Connect Puppeteer...');
let browser;
try {
  browser = await puppeteer.connect({ browserWSEndpoint: started.wsEndpoint, defaultViewport: null });
} catch (e) {
  console.error(`  ✗ Puppeteer connect fail: ${e.message}. Đang cleanup profile...`);
  await gpm.closeProfile(profileId).catch(() => {});
  throw e;
}
const tStart = Date.now() - t0;
console.log(`  ✓ Connected (${tStart} ms từ start API → connect xong)`);

let page = (await browser.pages())[0];
if (!page) page = await browser.newPage();

console.log(`▶ Mở ${url}...`);
const tNav0 = Date.now();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`  ✓ Page loaded (${Date.now() - tNav0} ms)`);
  const title = await page.title();
  console.log(`  Title: ${title}`);
} catch (e) {
  console.error(`  ✗ Goto failed: ${e.message}`);
}

// Detect login state đơn giản qua cookie
const cookies = await page.cookies('https://www.tiktok.com');
const hasSession = cookies.some(c => /sessionid|sid_tt|tt-target-idc/i.test(c.name));
console.log(`  Cookie session: ${hasSession ? 'YES (đã login)' : 'NO (guest)'}`);

console.log(`▶ Giữ mở ${keepOpen}s để bạn quan sát thủ công...`);
await new Promise(r => setTimeout(r, keepOpen * 1000));

console.log('▶ Disconnect Puppeteer...');
await browser.disconnect();

console.log('▶ Close profile...');
await gpm.closeProfile(profileId);
console.log('✓ Hoàn tất Phase 0 single test.');
