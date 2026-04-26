# PLAN — Master Roadmap

Tài liệu tổng hợp **toàn bộ đầu mục** của dự án seeding TikTok. Đọc file này để có cái nhìn end-to-end.

---

## 1. Phạm vi (Scope)

### 1.1 In-scope (làm)

| Nhóm | Chức năng |
|---|---|
| **Quản lý** | Pool account, pool proxy, pool GPM profile, mapping acc↔profile↔proxy |
| **Nuôi acc** | Warmup daily (FYP scroll, like, follow KOL, watch hashtag), session rotation |
| **Reg acc** | Đăng ký TK TikTok mới qua email/SMS, verify, cập nhật profile cơ bản |
| **Seeding live** | Mắt xem (concurrent viewer), comment, thả tim, click sản phẩm giỏ hàng |
| **Seeding video** | View, like, comment, share, follow, save |
| **Order system** | API nhận order → tách job → phân phối worker → tracking |
| **Dashboard** | Queue, log, success rate, acc health, alerts |
| **Multi-machine** | 1 master + 6 worker, communication HTTP/Redis |

### 1.2 Out-of-scope (giai đoạn 1, có thể làm sau)

- Bán hàng B2C (web bán dịch vụ) — chỉ làm API, FE bán hàng tách riêng.
- Thanh toán tự động (VNPAY, momo).
- Hệ thống đại lý/affiliate.
- Mobile emulator farm (chỉ dùng browser GPM).
- Hỗ trợ platform khác (Shopee Live, Facebook Live).

---

## 2. Đầu mục công việc (Work Breakdown Structure)

### EPIC A — Hạ tầng & Khung dự án
- **A1** Setup monorepo (pnpm workspace + TypeScript)
- **A2** Thiết kế DB schema (SQLite cho dev, Postgres cho prod)
- **A3** Cấu hình logger (pino), env (dotenv), code style (eslint + prettier)
- **A4** Docker compose cho master (Redis + Postgres + master app)
- **A5** Script setup worker trên Windows server (PM2 / NSSM)

### EPIC B — GPM Integration
- **B1** Wrapper GPM Runtime API (start/stop/list/create profile)
- **B2** Auto-detect GPM endpoint (v2/v3, port mặc định 19995)
- **B3** Connect Puppeteer qua CDP (`browserWSEndpoint`)
- **B4** Profile pool manager (track profile đang busy/idle)
- **B5** Profile lifecycle: tạo profile → gắn proxy → gắn acc → đánh dấu sẵn sàng
- **B6** Health check: profile có mở được không, có login được không

### EPIC C — TikTok Action Library
- **C1** Page object: TikTok web (`/foryou`, `/@user/live`, `/@user/video/{id}`)
- **C2** Action: login (cookie restore + verify)
- **C3** Action: scroll FYP với behavior tự nhiên
- **C4** Action: like video / unlike
- **C5** Action: follow / unfollow
- **C6** Action: comment (random từ template, anti-duplicate)
- **C7** Action: vào live, xem N giây (mắt)
- **C8** Action: thả tim live (spam tap)
- **C9** Action: click sản phẩm trong live (giỏ hàng)
- **C10** Action: share, save video
- **C11** Anti-pattern: random delay, mouse movement, scroll variance
- **C12** Captcha detection + handler (puzzle, slide) — báo về master nếu fail

### EPIC D — Account Management
- **D1** Schema: account (id, username, password, cookie, status, last_active, health_score)
- **D2** Import acc từ CSV (username|password|email|cookie)
- **D3** Login flow: thử cookie trước → nếu fail thì login bằng pass → save cookie
- **D4** Cookie refresh định kỳ (3–7 ngày/lần)
- **D5** Health score: tính từ % action thành công gần nhất, tuổi acc, follower
- **D6** Quarantine: acc bị check-point/ban → tách khỏi pool
- **D7** Acc tier: fresh / warmed / aged / VIP (gán theo health + tuổi)

### EPIC E — Account Warmup (Nuôi acc)
- **E1** Scheduler theo timezone VN (random 8h–23h)
- **E2** Daily routine: scroll FYP 5–15p, like 2–5 video, follow 1–2 KOL VN
- **E3** Weekly routine: post comment trên 1–2 video viral, watch live KOL
- **E4** Behavior diversity: mỗi acc có "personality" (thích nội dung gì) lưu trong DB
- **E5** Warmup ladder: D1–D3 chỉ scroll, D4–D7 thêm like, D8+ comment

### EPIC F — Account Registration
- **F1** Tích hợp dịch vụ SMS (smspool / 5sim / getsmscode)
- **F2** Tích hợp email tạm (mail.tm / firstmail)
- **F3** Reg flow web: nhập sđt → OTP → đặt pass → username → birthday
- **F4** Reg qua Google/Facebook (nếu có acc Gmail farm)
- **F5** Post-reg: avatar, bio, watch 5–10 video → save vào pool fresh
- **F6** Anti-detect: mỗi reg dùng profile GPM mới + proxy mới hoàn toàn

### EPIC G — Proxy Management
- **G1** Schema proxy (host, port, type, user, pass, country, isp, status)
- **G2** Health-check định kỳ (TCP + IP echo + geo verify)
- **G3** Sticky binding: 1 acc luôn dùng 1 proxy (giảm risk)
- **G4** Rotation logic: rotate sau N session hoặc khi proxy chết
- **G5** Proxy tier: DC (cho view) / Residential (cho action) / 4G (cho reg)

### EPIC H — Job & Queue System
- **H1** Job types enum: `live_view`, `live_comment`, `live_like`, `live_cart_click`, `video_view`, `video_like`, `video_comment`, `video_share`, `follow`, `warmup_daily`, `register`
- **H2** Queue: BullMQ + Redis, có priority + delayed + retry
- **H3** Job splitter: order 1000 mắt → 1000 sub-job (mỗi acc 1 mắt)
- **H4** Worker concurrency control: mỗi worker max 60 job đồng thời
- **H5** Job state machine: queued → assigned → running → success / failed / retrying
- **H6** Idempotency: rerun không bị duplicate

### EPIC I — Master API
- **I1** REST: `POST /orders`, `GET /orders/:id`, `GET /accounts`, `GET /workers`
- **I2** Auth: API key cho client, JWT cho admin
- **I3** Webhook: gọi callback khi order hoàn thành
- **I4** Rate limit + audit log

### EPIC J — Worker Agent
- **J1** Đăng ký với master (heartbeat mỗi 30s)
- **J2** Pull job theo capacity (60 - đang chạy)
- **J3** Execute job: lấy acc → start GPM profile → chạy action → close
- **J4** Report kết quả về master (success/fail + log + screenshot nếu fail)
- **J5** Self-recovery: profile crash → restart, machine restart → resume queue

### EPIC K — Dashboard
- **K1** Trang Overview: KPI realtime (job/giờ, success%, acc khả dụng)
- **K2** Trang Orders: list, filter, retry, cancel
- **K3** Trang Accounts: bulk import, filter theo health/tier, bulk action
- **K4** Trang Proxies: import, health, gán acc
- **K5** Trang Workers: trạng thái máy, profile đang chạy, restart từ xa
- **K6** Trang Logs: full-text search, filter

### EPIC L — Monitoring & Alert
- **L1** Prometheus metric (job rate, error rate, queue depth)
- **L2** Grafana dashboard
- **L3** Telegram bot alert: worker down, mass-fail, queue tắc
- **L4** Daily report: tổng job, doanh thu (nếu có), acc bị ban

### EPIC M — Security & Hardening
- **M1** Master expose qua VPN/Tailscale, không public internet
- **M2** Mã hoá password account trong DB (AES-256 + key trong env)
- **M3** Backup DB hàng ngày (cookies + acc rất giá trị)
- **M4** Anti-leak: log không in password/cookie

---

## 3. Roadmap theo phase

> Mỗi phase đều có sản phẩm **chạy được**, không phải cuối cùng mới có thành phẩm.

### Phase 0 — Discovery (0.5 ngày)
- Verify GPM Runtime API trên 1 máy (test start profile + connect Puppeteer).
- Verify proxy hoạt động qua GPM.
- Đo benchmark: 60 tab cùng vào 1 live tốn bao nhiêu RAM/CPU.

### Phase 1 — MVP single-machine (3–4 ngày)  ← **CHẠY ĐƯỢC NGAY**
- EPIC A1, A3
- EPIC B1, B2, B3, B4
- EPIC C1, C2, C3, C4, C7 (live view)
- EPIC D1, D2, D3
- EPIC G1 (cơ bản)
- CLI: `npm run job -- --type=live_view --url=... --count=30`
- **Output**: 1 máy có thể chạy 30–60 mắt live ngay với pool acc có sẵn.

### Phase 2 — Multi-machine + Queue (3–4 ngày)
- EPIC A4, A5
- EPIC H toàn bộ
- EPIC I1, I2
- EPIC J toàn bộ
- **Output**: master phân phối job xuống 7 worker, scale lên 420 mắt concurrent.

### Phase 3 — Mở rộng action (2–3 ngày)
- EPIC C5, C6, C8, C9, C10, C11
- **Output**: support đầy đủ tim, comment, click cart, like/comment video.

### Phase 4 — Warmup & Health (2–3 ngày)
- EPIC D4, D5, D6, D7
- EPIC E toàn bộ
- **Output**: pool acc tự nuôi, acc khỏe hơn theo thời gian.

### Phase 5 — Dashboard (3–4 ngày)
- EPIC K toàn bộ
- EPIC L1, L2
- **Output**: UI quản lý đầy đủ thay cho CLI.

### Phase 6 — Reg account tự động (3–5 ngày)
- EPIC F toàn bộ
- **Output**: tự reg 50–200 acc/ngày cấp vào pool.

### Phase 7 — Hardening & Scale (ongoing)
- EPIC L3, L4
- EPIC M toàn bộ
- Captcha solver tích hợp 2captcha
- Tối ưu RAM/CPU để đẩy 60 → 80–100 tab/máy

---

## 4. Tech stack chốt

| Layer | Choice | Lý do |
|---|---|---|
| Language | **Node.js + TypeScript** | Puppeteer/Playwright native, ecosystem tốt, dev nhanh |
| Browser ctrl | **Puppeteer-core** (connect CDP) | Không tự download Chromium, dùng GPM trực tiếp |
| Antidetect | **GPM Login** | Đã có license, fingerprint sẵn |
| Queue | **BullMQ + Redis** | Battle-tested, có priority/delay/retry |
| DB | **SQLite (dev) → PostgreSQL (prod)** | SQLite chạy ngay không cần setup |
| ORM | **Drizzle** | Light, type-safe, migration đơn giản |
| Master API | **Fastify** | Nhanh hơn Express, schema validation built-in |
| Dashboard | **Next.js 14 + shadcn/ui + Tailwind** | Modern, đẹp |
| Logger | **pino** | Nhanh, JSON structured |
| Process mgr | **PM2 / NSSM (Windows)** | Auto-restart worker khi crash |
| Monitoring | **Prometheus + Grafana** | Standard |
| Alert | **Telegram Bot API** | Free, realtime |

---

## 5. Đầu vào cần chuẩn bị

| Item | Trạng thái | Ghi chú |
|---|---|---|
| Node.js 20+ trên 7 máy | ⏳ | Cần cài |
| Redis | ⏳ | Cài trên máy master |
| GPM Login đã active 7 license | ✅ | Có sẵn |
| Pool TikTok account | ❌ | Cần import hoặc reg |
| Pool proxy VN | ❌ | Cần mua (DC + Residential) |
| Network giữa 7 máy | ❓ | LAN nội bộ hoặc VPN Tailscale |
| Domain + SSL cho dashboard | ❌ | Phase 5 mới cần |

---

## 6. Rủi ro & Mitigation

| Rủi ro | Tác động | Mitigation |
|---|---|---|
| TikTok update detect → bot fail hàng loạt | Cao | Action library tách rời, dễ fix nhanh; theo dõi success-rate qua dashboard |
| Profile GPM crash kéo cả tab | TB | Mỗi profile chạy job độc lập, có timeout + cleanup |
| Acc bị mass-ban | Cao | Warmup tốt, sticky proxy, không spam burst |
| Proxy chết giữa job | TB | Health-check + fallback, retry với proxy khác |
| Master down → toàn cluster đứng | Cao | Backup Redis + DB hằng ngày, master auto-restart PM2 |
| 60 tab/máy dồn vào 1 live → cùng IP đáng nghi | Cao | Bắt buộc proxy khác nhau cho từng profile, không dùng IP gốc cho mục seeding |

---

## 7. Câu hỏi chưa trả lời

- [ ] Phiên bản GPM Runtime đang dùng (v2/v3, port)?
- [ ] Có sẵn pool acc TikTok chưa, format thế nào?
- [ ] Có proxy nào sẵn chưa, hay cần mình recommend nhà cung cấp?
- [ ] 7 máy có cùng LAN không, hay cần VPN?
- [ ] Máy master tách riêng hay dùng chung 1 trong 7 máy?
- [ ] OS chính xác (Win Server 2019/2022)?

---

## 8. Tài liệu liên quan

- `ARCHITECTURE.md` — Kiến trúc kỹ thuật chi tiết.
- `MODULES.md` — Breakdown từng module.
- `SCHEMA.md` — DB schema.
- `OPERATIONS.md` — Vận hành cluster.
