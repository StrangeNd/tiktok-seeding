# ARCHITECTURE — Kiến trúc kỹ thuật

## 1. Sơ đồ tổng thể

```
                     ┌────────────────────────┐
                     │   CLIENT / ADMIN UI    │
                     │   (Next.js dashboard)  │
                     └──────────┬─────────────┘
                                │ HTTPS (REST/WS)
                                ▼
┌───────────────────────────────────────────────────────────┐
│                   MASTER NODE  (Máy #1)                   │
│ ┌──────────┐  ┌────────────┐  ┌─────────────┐  ┌────────┐ │
│ │ Fastify  │→ │  BullMQ    │  │  Drizzle    │  │ pino   │ │
│ │ REST API │  │  + Redis   │  │  + Postgres │  │ logger │ │
│ └──────────┘  └─────┬──────┘  └─────────────┘  └────────┘ │
└────────────────────┼──────────────────────────────────────┘
                     │ Redis pub/sub + BullMQ workers
   ┌─────────────────┼─────────────────┬────────────────┐
   ▼                 ▼                 ▼                ▼
┌──────────┐   ┌──────────┐     ┌──────────┐    ┌──────────┐
│ WORKER 1 │   │ WORKER 2 │ ... │ WORKER 6 │    │ FARM-W   │
│ (Máy #2) │   │ (Máy #3) │     │ (Máy #7) │    │ (reg/    │
│          │   │          │     │          │    │  warmup) │
│ ┌──────┐ │   │ ┌──────┐ │     │ ┌──────┐ │    │          │
│ │Agent │ │   │ │Agent │ │     │ │Agent │ │    │          │
│ │  +   │ │   │ │  +   │ │     │ │  +   │ │    │          │
│ │ GPM  │ │   │ │ GPM  │ │     │ │ GPM  │ │    │          │
│ │Runtime│ │   │ │Runtime│ │     │ │Runtime│ │    │          │
│ │  ↕   │ │   │ │  ↕   │ │     │ │  ↕   │ │    │          │
│ │60 prof│ │   │ │60 prof│ │     │ │60 prof│ │    │          │
│ └──────┘ │   │ └──────┘ │     │ └──────┘ │    │          │
└──────────┘   └──────────┘     └──────────┘    └──────────┘
     │              │                 │
     ▼              ▼                 ▼
   IP-1           IP-2              IP-3   (3 dải IP nhà mạng)
     +              +                 +
   Proxy pool gắn theo từng GPM profile (sticky-by-account)
```

## 2. Thành phần chính

### 2.1 Master Node
**Chỉ chạy trên 1 máy** (có thể tận dụng máy yếu nhất hoặc máy có uptime tốt nhất).

Dịch vụ:
- **Fastify API** (port 7000): nhận order từ client, expose REST cho dashboard.
- **Redis** (port 6379): backend cho BullMQ + pub/sub heartbeat worker.
- **PostgreSQL** (port 5432): lưu account, proxy, profile, job, log.
- **BullMQ orchestrator**: tách order → job, push vào queue tương ứng.
- **Worker registry**: track 6 worker (capacity, current load, last heartbeat).

### 2.2 Worker Node
Mỗi máy còn lại chạy 1 process **Agent** (Node.js) + GPM Runtime.

Trách nhiệm:
- Đăng ký với master khi khởi động (`POST /workers/register`).
- Heartbeat mỗi 30s với capacity hiện tại.
- Subscribe BullMQ queue → nhận job theo concurrency setting (mặc định 60).
- Với mỗi job:
  1. Lấy 1 acc + proxy từ master (`POST /accounts/lease`).
  2. Gọi GPM Runtime: `POST /api/v3/profiles/start/{profileId}`.
  3. Nhận `wsEndpoint`, `puppeteer.connect`.
  4. Chạy action từ `tiktok-actions` library.
  5. Đóng profile: `GET /api/v3/profiles/close/{profileId}`.
  6. Trả acc về pool, report kết quả.

### 2.3 Farm Worker (tuỳ chọn)
1 trong 7 máy có thể được dedicate cho:
- **Registration**: reg acc mới (chậm hơn, cần SMS/email).
- **Warmup**: chạy daily routine cho acc fresh.

Hoặc các máy worker thường vẫn nhận job warmup khi rảnh (mix workload).

## 3. Tích hợp GPM

### 3.1 GPM Runtime API (giả định v3)

```
POST   http://127.0.0.1:19995/api/v3/profiles/start/{profile_id}
       → { success: true, data: { browser_location, remote_debugging_address } }

GET    http://127.0.0.1:19995/api/v3/profiles/close/{profile_id}

GET    http://127.0.0.1:19995/api/v3/profiles?group_id=...&page=1&per_page=50
       → list profile

POST   http://127.0.0.1:19995/api/v3/profiles/create
       Body: { profile_name, group_id, browser_core, browser_version, os, user_agent, proxy, ... }
```

> Endpoint cụ thể sẽ được verify ở Phase 0 (Discovery). Wrapper viết trong `packages/gpm-client` để cô lập breakage.

### 3.2 Connect Puppeteer qua CDP

```ts
import puppeteer from 'puppeteer-core';
import { gpm } from '@app/gpm-client';

const { wsEndpoint } = await gpm.startProfile(profileId);
const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
const [page] = await browser.pages();
// ... chạy action
await browser.disconnect();
await gpm.closeProfile(profileId);
```

### 3.3 Mapping account ↔ profile ↔ proxy

Mỗi acc TikTok được gán **cố định** với 1 GPM profile và 1 proxy:

```
Account(uid=12345)  ──1:1──>  GPMProfile(id="abc-xyz")  ──1:1──>  Proxy(id=88)
```

Lý do:
- TikTok track device fingerprint → đổi fingerprint = bị check đăng nhập lại.
- IP đổi liên tục cũng đáng nghi → sticky.
- Khi acc bị quarantine, profile + proxy đi cùng acc luôn.

## 4. Luồng xử lý 1 đơn hàng

Ví dụ: KH đặt **500 mắt live** trong **10 phút**.

```
1. Client     → POST /orders { type: "live_view", url, count: 500, duration: 600 }
2. Master     → tạo Order(id=1001, status=queued)
              → splitter tạo 500 sub-job: { acc, target_url, watch_seconds: 600 }
              → push vào queue "live_view" với delay rải đều 0–60s đầu (tránh burst)
3. Worker     → BullMQ delivers job
              → lease 1 acc (ưu tiên acc warmed, chưa dùng trong 30p)
              → start GPM profile của acc đó (proxy đã gắn sẵn trong profile)
              → puppeteer.connect → vào URL live → đợi 600s
              → close profile, release acc với cooldown 30p
              → report success
4. Master     → cập nhật Order.completed += 1
              → khi == 500 → status="done", gọi webhook KH
```

## 5. Data flow proxy

```
                Mua proxy (DC/Residential)
                          │
                          ▼
         Import vào Master DB (table proxy)
                          │
                          ▼
         Health-check job (mỗi 30 phút)
                          │
                          ▼
       Gán proxy vào GPM profile (qua API update profile)
                          │
                          ▼
       Profile dùng proxy đó MÃI MÃI (sticky)
```

## 6. Communication protocols

| From → To | Protocol | Mục đích |
|---|---|---|
| Client → Master | HTTPS REST | Đặt order, query trạng thái |
| Dashboard → Master | HTTPS REST + WebSocket | UI realtime |
| Master ↔ Redis | TCP | Queue + pub/sub |
| Worker → Master (BullMQ) | Redis protocol | Pull job |
| Worker → Master (API) | HTTP | Lease acc, report log, heartbeat |
| Worker Agent → GPM Runtime | HTTP local | Start/close profile |
| Agent → Browser | CDP (WebSocket) | Automation |

## 7. Khả năng mở rộng

| Tăng trưởng | Cách scale |
|---|---|
| Cần > 420 viewer concurrent | Thêm máy worker, nâng concurrency 60→80 nếu RAM cho phép |
| Cần > 1000 acc | Tăng pool, chia group GPM theo tier acc |
| Master quá tải | Tách Redis + Postgres ra máy riêng, nhân master read-replica |
| Nhiều region | Pool proxy theo geo, route job theo target audience |

## 8. Failure modes & recovery

| Sự cố | Phát hiện | Xử lý tự động |
|---|---|---|
| Worker mất heartbeat > 90s | Master flag offline | Re-queue các job đang assigned cho worker đó |
| GPM Runtime crash | Agent bắt error khi gọi API | Restart GPM via PowerShell, retry job |
| Profile mở lỗi (corrupted) | Puppeteer connect timeout | Mark profile broken, cần check tay |
| TikTok captcha xuất hiện | Action lib detect DOM | Fail job, đẩy acc vào quarantine 24h |
| Acc bị logout | Login fail | Thử cookie refresh; nếu fail 2 lần → quarantine |
| Proxy chết | HTTP timeout | Mark proxy dead, gán acc proxy mới (Phase 2+) |

## 9. Bảo mật

- Master chỉ accessible qua **VPN nội bộ** (Tailscale recommended cho 7 máy phân tán).
- API key cho client; JWT cho admin dashboard.
- Mã hoá password TikTok account trong DB (AES-GCM, key trong env file `.env` không commit).
- Cookie acc lưu **base64 + encrypt**, chỉ giải mã khi cần dùng.
- Log không in raw cookie/password (mask).
- Backup DB hằng ngày (acc pool là tài sản giá trị nhất).
