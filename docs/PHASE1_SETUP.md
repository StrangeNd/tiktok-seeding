# Phase 1 — Setup & E2E Test (single-machine MVP)

Mục tiêu: chạy được luồng đầy đủ trên 1 máy dev — tạo order → master dispatch → worker pickup → mở GPM profile → load TikTok → ghi kết quả vào DB.

> **Yêu cầu Phase 0**: GPMLoginGlobal đang chạy (port 9495), pool có ≥ 5 profile.

## 1. Cài dependencies hệ thống

### Node.js + pnpm
```powershell
winget install OpenJS.NodeJS.LTS
npm install -g pnpm@9
```

### PostgreSQL 17
```powershell
winget install PostgreSQL.PostgreSQL.17
```

Sau khi cài, tạo DB + user:

```powershell
# Mở PowerShell mới (PATH update). Mặc định password postgres set khi cài.
$env:PGPASSWORD = "postgres"  # password bạn đặt khi cài
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE seeding;"
```

Verify: `psql -U postgres -h 127.0.0.1 -d seeding -c "select version();"`

### Memurai (Redis cho Windows)
```powershell
winget install Memurai.MemuraiDeveloper
```

Memurai tự start như Windows Service. Verify:
```powershell
redis-cli ping  # nên trả "PONG"
```
Nếu không có `redis-cli` thì Memurai có sẵn `memurai-cli`.

## 2. Cài npm dependencies + setup repo

```powershell
cd "C:\Users\Stephen Strange\CascadeProjects\tiktok-seeding"
pnpm install
Copy-Item .env.example .env
# Mở .env, sửa DATABASE_URL nếu password Postgres khác
```

`.env` mẫu:
```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding
REDIS_URL=redis://127.0.0.1:6379
GPM_ENDPOINT=http://127.0.0.1:9495
MASTER_API_KEY=dev-key-change-me
WORKER_NAME=worker-local
CONCURRENCY=5
```

## 3. Generate + apply DB migrations

```powershell
pnpm db:generate    # tạo SQL migration từ schema.ts vào apps/master/drizzle/
pnpm db:migrate     # apply lên DB
```

Verify schema:
```powershell
psql -U postgres -d seeding -c "\dt"
```
Phải thấy 4 table: `profiles`, `orders`, `jobs`, `workers`.

## 4. Khởi động services

Mở **3 terminal** trong cùng thư mục repo:

### Terminal 1 — Master API
```powershell
pnpm master
```
Kỳ vọng: `✓ Master API listening on :7000`

### Terminal 2 — Worker
```powershell
pnpm worker
```
Kỳ vọng: `✓ Worker started` + heartbeat log mỗi 20s.

### Terminal 3 — CLI
```powershell
# 4a. Sync profile từ GPM vào DB
pnpm --filter @app/cli run sync-profiles

# 4b. Tạo 1 order test (5 viewer xem 30s)
pnpm --filter @app/cli run create-order -- --url=https://www.tiktok.com/foryou --count=5 --watch=30 --spread=10

# 4c. Xem trạng thái
pnpm --filter @app/cli run list-orders
pnpm --filter @app/cli run list-orders -- --id=1
```

## 5. Quan sát

- **Terminal Master**: log `Job started` (từ Fastify request log)
- **Terminal Worker**: log `Job started` → `Profile started` → `Job done`
- **GPM Login app**: thấy 5 browser được mở rồi đóng dần
- **DB**:
  ```powershell
  psql -U postgres -d seeding -c "select id, status, completed_jobs, failed_jobs from orders order by id desc limit 5;"
  psql -U postgres -d seeding -c "select id, status, error_code, duration_ms from jobs where order_id = 1;"
  ```

## 6. Tiêu chí PASS Phase 1

- ✅ `pnpm typecheck` — không lỗi
- ✅ Master + Worker chạy đồng thời, không crash
- ✅ Sync profiles xong, DB có ≥ 5 profile
- ✅ Tạo order count=5 → 5/5 jobs `succeeded`, order status = `done`
- ✅ Profile được lock (`in_use`) khi đang chạy, release (`available`) khi xong
- ✅ Heartbeat worker xuất hiện trong table `workers`

Khi pass → ghi lại các số:
```
Avg job duration:        ___ s  (kỳ vọng < watchSeconds + 10s overhead)
Profile lock-release OK? ___
Concurrency thực tế:     ___  (so với CONCURRENCY=5 trong .env)
```

## 7. Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| Master fail `ECONNREFUSED 5432` | Postgres chưa start | `Get-Service postgresql*` rồi `Start-Service` |
| Master fail `ECONNREFUSED 6379` | Memurai chưa start | `Start-Service Memurai` |
| `db:migrate` fail | DB `seeding` chưa tạo | Tạo bằng psql như mục 1 |
| Worker connect GPM fail | GPM Login app chưa mở | Mở app, verify `npm run discover` ở `scripts/phase0` |
| Worker error `ProfileInUse` liên tục | GPM giữ lock từ run trước | Đóng tab thủ công trong GPM hoặc đợi 60s |
| Job failed `NavigationTimeout` | TikTok proxy chậm hoặc VPN sai region | Tăng `navTimeoutMs` trong `live-view.ts`, hoặc thử URL khác |

## 8. Sau khi pass → Phase 2

Phase 2 thêm:
- Account pool (login state, cookie encrypt)
- Multi-machine: master trên 1 máy, worker trên 6 máy còn lại
- Action mở rộng: scroll FYP, like, follow, comment
- Proxy management
- Dashboard UI (Next.js)
- Reg account tự động
