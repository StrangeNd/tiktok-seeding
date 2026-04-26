# OPERATIONS — Vận hành cluster 7 máy

## 1. Phân vai 7 máy

| Máy | Vai trò | Service chạy | Mạng IP |
|---|---|---|---|
| **#1** Master | Orchestrator + DB + Dashboard | Postgres, Redis, master API, dashboard | IP-1 (cũng có thể không cần out internet nhiều) |
| #2 Worker-1 | Seeding worker | GPM Runtime + Worker Agent (60 profile) | IP-1 |
| #3 Worker-2 | Seeding worker | GPM Runtime + Worker Agent (60 profile) | IP-1 |
| #4 Worker-3 | Seeding worker | GPM Runtime + Worker Agent (60 profile) | IP-2 |
| #5 Worker-4 | Seeding worker | GPM Runtime + Worker Agent (60 profile) | IP-2 |
| #6 Worker-5 | Seeding worker | GPM Runtime + Worker Agent (60 profile) | IP-3 |
| #7 Farm | Reg + Warmup + dự phòng | GPM Runtime + Worker Agent + reg consumer | IP-3 |

Tổng concurrency seeding: **6 × 60 = 360 profile** (giữ lại 60 cho farm/reg).

> Lưu ý: 60 profile/máy đều dùng **proxy riêng** (không dùng IP gốc của máy), nên 3 dải IP nhà chỉ là kênh kết nối, không phải nguồn IP cho TikTok.

## 2. Cài đặt phần mềm trên mỗi máy

### 2.1 Master (#1)
```powershell
# Node.js 20 LTS
winget install OpenJS.NodeJS.LTS

# Git
winget install Git.Git

# PostgreSQL 15 (or 16)
winget install PostgreSQL.PostgreSQL

# Redis (Memurai for Windows hoặc Redis WSL)
winget install Memurai.MemuraiDeveloper

# PM2 để quản lý process
npm install -g pm2 pm2-windows-startup

# Tailscale (VPN nội bộ tuỳ chọn)
winget install Tailscale.Tailscale
```

### 2.2 Worker (#2-#7)
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
npm install -g pm2 pm2-windows-startup

# GPM Login đã cài sẵn → đảm bảo GPM Runtime auto-start
# Tailscale (nếu master không cùng LAN)
winget install Tailscale.Tailscale
```

## 3. Triển khai code

### 3.1 Master
```powershell
cd C:\app
git clone <repo> tiktok-seeding
cd tiktok-seeding
npm install
npm run db:migrate
pm2 start ecosystem.master.js
pm2 save
pm2-startup install
```

### 3.2 Worker
```powershell
cd C:\app
git clone <repo> tiktok-seeding
cd tiktok-seeding
npm install
# .env có WORKER_NAME, MASTER_URL, GPM_ENDPOINT
pm2 start ecosystem.worker.js
pm2 save
pm2-startup install
```

## 4. File `.env` mẫu

### Master
```env
NODE_ENV=production
PORT=7000

DATABASE_URL=postgres://app:****@127.0.0.1:5432/seeding
REDIS_URL=redis://127.0.0.1:6379

ENCRYPTION_KEY=<32-byte-base64>
JWT_SECRET=<random>

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

LOG_LEVEL=info
```

### Worker
```env
NODE_ENV=production
WORKER_NAME=worker-2
MASTER_URL=http://100.x.y.z:7000
MASTER_API_KEY=<key>

GPM_ENDPOINT=http://127.0.0.1:19995
GPM_API_KEY=

CONCURRENCY=60
LOG_LEVEL=info
```

## 5. PM2 ecosystem

### `ecosystem.master.js`
```js
module.exports = {
  apps: [
    { name: 'master-api', script: 'apps/master/dist/index.js', instances: 1, max_memory_restart: '2G' },
    { name: 'dashboard', script: 'apps/dashboard/server.js', instances: 1, max_memory_restart: '1G' },
  ],
};
```

### `ecosystem.worker.js`
```js
module.exports = {
  apps: [
    { name: 'worker-agent', script: 'apps/worker/dist/index.js', instances: 1, max_memory_restart: '4G', exp_backoff_restart_delay: 5000 },
  ],
};
```

## 6. Mạng & VPN

**Khuyến nghị Tailscale**:
- Cài trên cả 7 máy → mỗi máy có IP `100.x.x.x` ổn định.
- Master expose API chỉ trên Tailscale interface (không bind 0.0.0.0).
- Worker connect master qua Tailscale IP.
- Dashboard cũng truy cập qua Tailscale (admin từ máy bàn cũng cài Tailscale).

**Tránh tuyệt đối**:
- Expose master API ra public internet không có WAF.
- Dùng IP gốc của máy worker làm proxy cho TikTok (bị flag chéo).

## 7. Proxy mapping

```
Mỗi acc TikTok ←→ 1 GPM profile ←→ 1 proxy.
```

Quy trình gán:
1. Import 100 acc + 100 proxy vào master.
2. Script `scripts/assign-profile-proxy.ts` tạo 100 profile GPM (qua API), gán proxy tương ứng vào từng profile.
3. Update DB: `accounts.profile_id`, `accounts.proxy_id`.
4. Phân bổ profile cho worker (thường mỗi worker giữ ~60 profile của ~60 acc).

## 8. Monitoring

### 8.1 Metrics (Prometheus exposition tại `/metrics` của master)
- `seeding_jobs_total{type, status}` — counter
- `seeding_job_duration_seconds{type}` — histogram
- `seeding_queue_depth{type}` — gauge
- `seeding_worker_load{worker}` — gauge
- `seeding_account_pool{tier, status}` — gauge

### 8.2 Grafana dashboard
Panel cần có:
- Job rate by type (line)
- Success rate % (gauge)
- Queue depth (line, alert > 10000)
- Worker load (bar)
- Account pool by tier (stack area)
- Top error codes (table)

### 8.3 Alert (Telegram bot)
Trigger:
- Worker offline > 2 phút
- Success rate < 70% trong 10p liên tục
- Queue depth > 20.000
- Acc pool active < 100
- Postgres disk > 85%

## 9. Backup

| Đối tượng | Tần suất | Lưu trữ |
|---|---|---|
| Postgres dump | Hằng ngày 03:00 | Giữ 30 bản, copy sang ổ ngoài / NAS |
| GPM profile data | Hằng tuần | Snapshot folder profile của GPM Login |
| .env / config | Khi thay đổi | Lưu vào vault (1Password / Bitwarden) |
| Redis | Mỗi 6h (RDB) | Local |

## 10. Vận hành hằng ngày

### Buổi sáng (8h)
- Check Telegram alert đêm qua.
- Xem daily report: tổng job, success rate, acc bị quarantine.
- Health check 7 worker.
- Restart worker nào đang stuck.

### Buổi chiều (14h)
- Reg thêm acc nếu pool fresh < 200.
- Check proxy expire trong 7 ngày tới.

### Cuối ngày (22h)
- Verify backup chạy.
- Nếu success rate giảm bất thường → kiểm tra TikTok có update không (DOM thay đổi).

## 11. Disaster recovery

| Sự cố | Action |
|---|---|
| Master crash, máy chết | Khôi phục từ snapshot DB ngày gần nhất, dựng lại trên máy backup |
| GPM profile data hỏng 1 worker | Re-create profile, re-assign acc + proxy |
| Mất key encryption | **Mất toàn bộ cookie + password** → reg lại pool. Backup key vào vault! |
| TikTok ban hàng loạt | Đóng pool, phân tích: proxy dirty? action quá burst? Update behavior, dùng pool fresh |

## 12. Checklist on-call

- [ ] PM2 status all green trên 7 máy
- [ ] Tailscale 7 nút online
- [ ] Postgres + Redis up
- [ ] Master `/health` 200
- [ ] Worker heartbeat < 60s
- [ ] Queue depth < 5000
- [ ] Acc pool active > 200
- [ ] Disk < 70%
- [ ] Daily backup tồn tại trong 24h
