# Phase 0 — Discovery & Benchmark

Mục tiêu: trước khi viết code thật, **xác minh** trên 1 máy:

1. **GPMLogin Global API** hoạt động và kết nối được.
2. Puppeteer connect qua CDP vào profile thật và automate được TikTok.
3. Máy thật sự chạy ổn N tab cùng lúc (5 → 10 → 30 → 60).

3 script độc lập, không phụ thuộc gì ngoài `puppeteer-core`.

> **Lưu ý quan trọng về GPM**:
> - **GPM Login** = app antidetect chính, có sẵn **GPMLogin Global API** → đây là cái ta gọi.
> - **GPM Runtime** = app runtime riêng để chạy workflow no-code, **không phải nơi expose API**.
> - Doc chính thức: <https://docs.gpmloginapp.com/api-document>
> - Sample C#/Python: <https://github.com/buiducduy111/GPMLoginApiV3Sample>

---

## 0. Yêu cầu

- **Node.js 18+** (khuyến nghị 20 LTS)
- **GPM Login app** đang chạy với Local API bật (Settings → API)
- Có **ít nhất 1 profile** trong GPM để test single, **>= 60 profile** để benchmark đầy đủ
- (Tuỳ chọn) Đã gán proxy vào profile

## 1. Cài đặt

```powershell
cd scripts\phase0
npm install
```

Cài `puppeteer-core` (~50MB, không tải Chromium vì sẽ connect vào browser của GPM).

## 2. Discover GPM endpoint

```powershell
npm run discover
```

Script tự động probe các port phổ biến: **9495, 19995, 19999, 19996, 8080**.

Nếu app của bạn dùng port khác (kiểm tra Settings của GPM Login):

```powershell
node discover.mjs --port=9495
node discover.mjs --port=9495 --apiKey=YOUR_KEY
node discover.mjs --port=9495 --groupId=GROUP_ID    # chỉ lọc 1 group
```

**Output kỳ vọng**:
```
✓ Tìm thấy GPMLogin Global API:
  baseUrl:       http://127.0.0.1:9495
  prefix:        /api/v3
  sender:        GPMLoginGlobal v0.3.0-beta
  banner:        GPMLogin Global API

▶ Liệt kê profile (page 1, max 50)...
✓ Tổng: 12 profile (đang hiển thị 12)

  STT | ID                                    | Name        | Browser            | Group
  ----+---------------------------------------+-------------+--------------------+---------
    1 | 17169ef5-761a-4fc4-9fba-2b634424c8c9  | tk-001      | chromium 119       | default
    2 | ...

SAMPLE PROFILE ID (dùng cho test-single.mjs):
  17169ef5-761a-4fc4-9fba-2b634424c8c9
```

Tự động in command tiếp theo sẵn sàng copy-paste. Nếu fail xem bảng [Troubleshooting](#6-troubleshooting).

## 3. Test 1 profile (kiểm tra Puppeteer + automation)

```powershell
node test-single.mjs --port=9495 --profileId=<PROFILE_ID> --url=https://www.tiktok.com/foryou --keepOpen=20
```

Script sẽ:
1. Start profile qua GPMLogin Global API (`GET /api/v3/profiles/start/{id}`)
2. Nhận `remote_debugging_address` (dạng `127.0.0.1:53378`)
3. Gọi `/json/version` để lấy `webSocketDebuggerUrl`
4. Connect Puppeteer qua CDP
5. Mở URL, in title + cookie status
6. Giữ mở N giây để quan sát
7. Disconnect + close profile (`GET /api/v3/profiles/close/{id}`)

**Output kỳ vọng**:
```
▶ Start profile 17169ef5-...
  remote: 127.0.0.1:53378
  wsEndpoint: ws://127.0.0.1:53378/devtools/browser/abc...
✓ Connected (3245 ms)
✓ Page loaded (2890 ms)
  Title: TikTok - Make Your Day
  Cookie session: YES (đã login)
✓ Hoàn tất Phase 0 single test.
```

## 4. Benchmark N profile concurrent

**Bắt đầu nhỏ rồi tăng dần** để tránh máy đứng:

```powershell
# Thử 5 profile, hold 30s
node benchmark.mjs --port=9495 --count=5 --hold=30 --rampUpMs=500

# Tăng lên 10
node benchmark.mjs --port=9495 --count=10 --hold=30

# Mục tiêu: 60 profile, hold 2 phút
node benchmark.mjs --port=9495 --count=60 --hold=120 --rampUpMs=800
```

Tham số:

| Flag | Mặc định | Ý nghĩa |
|---|---|---|
| `--count=N` | 10 | Số profile mở song song |
| `--url=...` | `https://www.tiktok.com/foryou` | URL load trên mỗi profile |
| `--hold=SEC` | 60 | Giữ tab mở bao lâu trước khi đóng |
| `--rampUpMs=MS` | 800 | Delay giữa mỗi lần spawn (giảm peak CPU) |

**Script sẽ in mỗi 5 giây** RAM hiện tại + số browser đang active. Cuối cùng tổng kết:

```
══════ KẾT QUẢ BENCHMARK ══════
  Profile mở thành công:  60/60
  Profile lỗi:            0
  Avg connect time:       4123 ms
  Avg nav time:           5821 ms
  Tổng spawn time:        58234 ms
  RAM peak ước tính:      48000/65536 MB
  RAM/profile (xấp xỉ):   ~600 MB
═══════════════════════════════
```

## 5. Tiêu chí pass Phase 0

- ✅ `discover.mjs` tìm được GPMLogin Global API + list được profile
- ✅ `test-single.mjs` mở được TikTok thành công, automation chạy
- ✅ `benchmark.mjs --count=60` → success >= 95%, RAM còn dư > 10%, máy không lag

Khi cả 3 pass → ghi lại các số liệu sau và báo mình:

```
GPM endpoint:           http://127.0.0.1:9495
GPM sender:             GPMLoginGlobal v0.3.0-beta
Tổng profile pool:      ___
RAM/profile trung bình: ___ MB
Avg connect time:       ___ ms
Avg nav time:           ___ ms
Max profile concurrent: ___
Failure rate tại 60 tab: ___ %
```

→ Mình sẽ dùng số này để **chốt thiết kế Phase 1** (concurrency, timeout, slot).

## 6. Troubleshooting

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Không tìm thấy GPMLogin Global API` | App chưa mở, hoặc port không nằm trong default list | Mở `http://127.0.0.1:<port>/` trên trình duyệt để verify, rồi `--port=<port>` |
| `data: "GPMLogin Global API"` (banner) | Đụng route root `/` thay vì list endpoint | Đã fix ở phiên bản mới của script (banner chỉ dùng để confirm đúng GPM) |
| `listProfiles HTTP 401/403` | API cần key | `--apiKey=<key>` hoặc set `GPM_API_KEY` env |
| `startProfile: missing remote_debugging_address` | License GPM không còn hạn / profile lỗi | Kiểm tra license + thử mở profile thủ công trên app |
| `Cannot resolve WS endpoint` | Browser chưa expose CDP | Thử lại sau 1–2 giây, hoặc tăng `RAMP_MS` |
| Puppeteer `Protocol error` | Phiên bản Chrome trong GPM quá cũ | Update `gpm_browser` trong app GPM |
| Spawn 60 thất bại từ #20 trở đi | RAM cạn / GPM không cho parallel | Giảm `count` hoặc tăng `rampUpMs=2000` |
| Browser disconnect ngay sau connect | GPM tự đóng do idle timeout | Luôn có hoạt động (page.goto) ngay sau connect |

## 7. Sau khi xong

Thông tin thu được sẽ feed vào Phase 1:

- Endpoint + prefix → cấu hình `packages/gpm-client`
- RAM/profile → tính concurrency thực tế
- Latency connect → set timeout cho job runner
- Tỷ lệ lỗi → quyết định retry policy
