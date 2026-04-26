// probe.mjs — Sweep nhiều endpoint candidate trên GPMLoginGlobal để tìm path/auth đúng.
// Lý do: bản v0.3.0-beta đang trả banner cho mọi route, có thể vì:
//   - Sai path (đã đổi từ /api/v3 sang /api hoặc khác)
//   - Cần auth header (Authorization: Bearer xxx)
//   - Local API tách port riêng, ngoài port 9495 (Global API)
//
// Usage:
//   node probe.mjs                             # default port 9495, không auth
//   node probe.mjs --port=9495 --apiKey=xxx
//   node probe.mjs --port=19995                # thử port Local API cũ
//   node probe.mjs --scan                      # scan thêm các port phổ biến

import { httpJson } from './gpm.mjs';

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
const targetPorts = args.scan
  ? [9495, 19995, 19999, 19996, 8080, 9222, 9001, 6699, 7777, 5000, 3000, 8000]
  : [Number(args.port ?? 9495)];

// Banner mà GPMLoginGlobal trả về cho route không match
const BANNER_DATA = 'GPMLogin Global API';

const PATHS = [
  // V3 chuẩn theo doc cũ
  '/api/v3/profiles',
  '/api/v3/profiles?page=1&per_page=1',
  '/api/v3/groups',
  '/api/v3/profile',
  '/api/v3/profile/list',
  '/api/v3/browser-profiles',

  // V2 / V1
  '/api/v2/profiles',
  '/api/v1/profiles',

  // Không version
  '/api/profiles',
  '/api/profiles?page=1',
  '/api/groups',
  '/api/list',
  '/api/profile/list',

  // Không prefix /api
  '/profiles',
  '/v3/profiles',

  // Doc / discovery
  '/docs',
  '/swagger',
  '/swagger/index.html',
  '/openapi.json',
  '/api-docs',
  '/redoc',

  // Health / version
  '/health',
  '/version',
  '/api/health',
  '/api/version',
  '/status',

  // Hành động cụ thể (chỉ test path tồn tại)
  '/api/v3/profiles/start/test-id',
  '/api/profiles/start/test-id',
];

async function probeOne(baseUrl, path, headers) {
  try {
    const r = await httpJson(`${baseUrl}${path}`, { timeoutMs: 3000, headers });
    return { status: r.status, body: r.body };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

function classify(result) {
  if (result.status === 0) return 'NETWORK_ERROR';
  if (result.status === 404) return 'NOT_FOUND';
  if (result.status === 401 || result.status === 403) return 'AUTH_REQUIRED';
  if (result.status >= 500) return 'SERVER_ERROR';
  if (typeof result.body === 'string') return result.body.includes('<html') ? 'HTML' : 'TEXT';
  if (result.body && typeof result.body === 'object') {
    if (result.body.data === BANNER_DATA) return 'BANNER (default route)';
    if (Array.isArray(result.body.data)) return `JSON_ARRAY (${result.body.data.length})`;
    if (result.body.data && typeof result.body.data === 'object') return 'JSON_OBJECT';
    if (result.body.success === false) return `JSON_ERROR: ${result.body.message ?? '?'}`;
    return 'JSON_OTHER';
  }
  return `STATUS_${result.status}`;
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(' GPMLoginGlobal endpoint probe');
console.log('═══════════════════════════════════════════════════════════════\n');

for (const port of targetPorts) {
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`▶ Port ${port} (${baseUrl})`);

  // Probe banner trước
  const banner = await probeOne(baseUrl, '/');
  if (banner.status === 0) {
    console.log(`  ✗ Port không mở: ${banner.error}\n`);
    continue;
  }
  console.log(`  Root /: status=${banner.status} sender=${banner.body?.sender ?? '?'} data="${typeof banner.body?.data === 'string' ? banner.body.data : '<object>'}"`);

  const headerVariants = [
    { label: 'no-auth', headers: {} },
    ...(apiKey ? [
      { label: 'Bearer', headers: { Authorization: `Bearer ${apiKey}` } },
      { label: 'X-API-Key', headers: { 'X-API-Key': apiKey } },
      { label: 'api-key', headers: { 'api-key': apiKey } },
    ] : []),
  ];

  for (const { label, headers } of headerVariants) {
    console.log(`\n  ─── auth: ${label} ───`);
    const interesting = [];
    for (const path of PATHS) {
      const r = await probeOne(baseUrl, path, headers);
      const cls = classify(r);
      // Chỉ in các response "interesting" — không banner, không 404
      if (cls !== 'BANNER (default route)' && cls !== 'NOT_FOUND' && cls !== 'NETWORK_ERROR') {
        interesting.push({ path, cls, status: r.status, sample: JSON.stringify(r.body).slice(0, 200) });
      }
    }
    if (interesting.length === 0) {
      console.log('    (mọi path đều trả về banner hoặc 404)');
    } else {
      interesting.forEach(i => {
        console.log(`    ${i.cls.padEnd(28)} ${String(i.status).padEnd(4)} ${i.path}`);
        console.log(`      sample: ${i.sample}`);
      });
    }
  }
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('Diễn giải:');
console.log('  - BANNER nghĩa là route fallback về root → path sai');
console.log('  - JSON_ARRAY là điều ta muốn → đó là endpoint list thật');
console.log('  - AUTH_REQUIRED (401/403) → cần API key');
console.log('  - NOT_FOUND → đường thật không phải path đó');
console.log('═══════════════════════════════════════════════════════════════');
