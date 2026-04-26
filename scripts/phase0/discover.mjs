// discover.mjs — Tìm GPMLogin Global API endpoint + list profile.
// Doc: https://docs.gpmloginapp.com/api-document
//
// Usage:
//   node discover.mjs                         # auto-probe các port phổ biến
//   node discover.mjs --port=9495             # chỉ probe 1 port
//   node discover.mjs --apiKey=YOUR_KEY       # nếu API yêu cầu key
//   node discover.mjs --groupId=GROUP_ID      # lọc theo group

import { discoverGPM, GPMClient } from './gpm.mjs';

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
const ports = args.port ? [Number(args.port)] : undefined;

console.log('▶ Discovering GPMLogin Global API...');
const found = await discoverGPM({ apiKey, ports });
if (!found) {
  console.error('✗ Không tìm thấy GPMLogin Global API.');
  console.error('');
  console.error('  Kiểm tra:');
  console.error('  1. Đã mở app GPM Login chưa? (đây là app antidetect, không phải GPM Runtime)');
  console.error('  2. Vào Settings của app → mục API → kiểm tra Local API có bật, port là bao nhiêu.');
  console.error('  3. Mở thử trên trình duyệt: http://127.0.0.1:<port>/');
  console.error('     Nếu thấy {"data":"GPMLogin Global API",...} là đúng app.');
  console.error('  4. Truyền port: node discover.mjs --port=<port>');
  console.error('  5. Một số bản yêu cầu API key: --apiKey=<key>');
  process.exit(1);
}

console.log('✓ Tìm thấy GPMLogin Global API:');
console.log('  baseUrl:      ', found.baseUrl);
console.log('  prefix:       ', found.prefix);
console.log('  sender:       ', found.sender ?? '(unknown)');
console.log('  banner:       ', found.banner ?? '(unknown)');
if (found.warning) console.log('  ⚠  warning:    ', found.warning);

if (found.warning && !found.sampleResponse?.success) {
  console.error('\n✗ List endpoint trả về không hợp lệ:');
  console.error(JSON.stringify(found.sampleResponse, null, 2).slice(0, 1000));
  process.exit(2);
}

const client = new GPMClient({ baseUrl: found.baseUrl, prefix: found.prefix, apiKey });

console.log('\n▶ Liệt kê profile (page 1, max 50)...');
try {
  const groupId = args.groupId;
  const list = await client.listProfiles({ perPage: 50, groupId });
  const items = list.items;
  const total = list.total;

  console.log(`✓ Tổng pool: ${total} profile (page ${list.page}/${list.lastPage}, đang hiển thị ${items.length})`);
  console.log('');
  console.log('  STT | ID                                    | Name                          | Browser            | Group');
  console.log('  ----+---------------------------------------+-------------------------------+--------------------+---------');
  items.slice(0, 20).forEach((p, i) => {
    const id = (p.id ?? '').padEnd(36).slice(0, 36);
    const name = (p.name ?? '').padEnd(30).slice(0, 30);
    const browser = `${p.browser_type ?? '?'} ${p.browser_version ?? ''}`.padEnd(18).slice(0, 18);
    const grp = (p.group_id ?? '').slice(0, 10);
    console.log(`  ${String(i + 1).padStart(3)} | ${id}  | ${name}| ${browser} | ${grp}`);
  });
  if (items.length > 20) console.log(`  ... và ${items.length - 20} profile khác`);

  if (items.length > 0) {
    console.log('\n──────────────────────────────────────────────────');
    console.log('SAMPLE PROFILE ID (dùng cho test-single.mjs):');
    console.log(`  ${items[0].id}`);
    console.log('──────────────────────────────────────────────────');
    console.log('\nLệnh tiếp theo:');
    console.log(`  node test-single.mjs --port=${new URL(found.baseUrl).port} --profileId=${items[0].id}`);
  } else {
    console.log('\n⚠  Chưa có profile nào trong GPM Login. Tạo profile trước khi sang bước sau.');
  }

  console.log('\n✓ Lưu vào .env cho Phase 1:');
  console.log(`  GPM_ENDPOINT=${found.baseUrl}`);
  console.log(`  GPM_API_PREFIX=${found.prefix}`);
  if (apiKey) console.log(`  GPM_API_KEY=<your-key>`);
} catch (err) {
  console.error('✗ List profile lỗi:', err.message);
  process.exit(2);
}
