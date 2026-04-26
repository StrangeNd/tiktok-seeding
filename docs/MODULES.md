# MODULES — Breakdown chi tiết từng module

Mỗi module có **mục đích, input, output, dependency**. Đây là blueprint trước khi viết code.

---

## packages/shared

**Mục đích**: Type, enum, constant, util dùng chung cho master + worker.

| File | Nội dung |
|---|---|
| `types/job.ts` | `JobType`, `JobStatus`, `JobPayload<T>`, `JobResult` |
| `types/account.ts` | `Account`, `AccountStatus`, `AccountTier` |
| `types/proxy.ts` | `Proxy`, `ProxyType`, `ProxyStatus` |
| `types/profile.ts` | `GPMProfile`, `ProfileStatus` |
| `types/order.ts` | `Order`, `OrderStatus` |
| `enums.ts` | Tất cả enum (job type, status...) |
| `constants.ts` | Timeout, max retry, port mặc định GPM, queue name |
| `utils/random.ts` | `randomInt`, `randomFloat`, `randomDelay`, `pickWeighted` |
| `utils/logger.ts` | pino instance config |
| `utils/crypto.ts` | encrypt/decrypt cookie + password (AES-GCM) |

---

## packages/gpm-client

**Mục đích**: Wrapper duy nhất giao tiếp với GPM Runtime API.

| File | Export |
|---|---|
| `client.ts` | `class GPMClient { startProfile, closeProfile, listProfiles, createProfile, updateProfile, deleteProfile }` |
| `types.ts` | Type response GPM (`StartProfileResponse`, `Profile`, ...) |
| `version-detect.ts` | Auto detect v2/v3 endpoint, port |
| `puppeteer-bridge.ts` | Helper `connectToProfile(profileId): Promise<Browser>` — tổng hợp start + connect |

**Ví dụ API**:
```ts
const gpm = new GPMClient({ endpoint: 'http://127.0.0.1:19995' });
const browser = await connectToProfile(gpm, 'profile-uuid');
// ... do stuff
await browser.disconnect();
await gpm.closeProfile('profile-uuid');
```

---

## packages/tiktok-actions

**Mục đích**: Library hành động trên TikTok web. Tách rời để khi TikTok thay đổi DOM thì sửa 1 chỗ.

### Submodules

| Submodule | Function | Note |
|---|---|---|
| `auth` | `loginByCookie(page, cookies)`, `loginByPassword(page, user, pass)`, `verifyLoggedIn(page)` | Cookie ưu tiên; pass là fallback |
| `live` | `enterLive(page, url)`, `watchLive(page, seconds)`, `tapHeart(page, count)`, `comment(page, text)`, `clickProductCart(page, productIndex?)` | Action chính cho seeding live |
| `video` | `viewVideo(page, url, watchPercent)`, `likeVideo(page)`, `commentVideo(page, text)`, `shareVideo(page)`, `saveVideo(page)` | Action cho video |
| `social` | `followUser(page, username)`, `unfollow(page, username)` | |
| `feed` | `scrollForYou(page, durationSec)`, `randomActions(page, opts)` | Dùng cho warmup |
| `behaviors` | `humanDelay(min, max)`, `humanMouseMove(page)`, `humanScroll(page)`, `humanType(page, selector, text)` | Anti-pattern |
| `detect` | `detectCaptcha(page)`, `detectLoginExpired(page)`, `detectRateLimit(page)` | Healthcheck |
| `selectors.ts` | Tập trung mọi CSS selector / XPath để dễ maintain | |

**Pattern thiết kế**: mỗi function nhận `page: Page` của Puppeteer + options, trả về `ActionResult { ok, data?, error? }`.

---

## apps/master

**Mục đích**: Orchestrator trung tâm.

### Cấu trúc

```
apps/master/src/
├── index.ts                 # Entry: khởi Fastify + BullMQ + cron
├── api/
│   ├── orders.ts            # POST/GET /orders
│   ├── accounts.ts          # CRUD acc, lease, release
│   ├── proxies.ts           # CRUD proxy
│   ├── workers.ts           # register, heartbeat, list
│   ├── jobs.ts              # query job log
│   └── auth.ts              # API key, JWT
├── queue/
│   ├── queues.ts            # Tạo BullMQ queue cho từng job type
│   ├── splitter.ts          # Order → sub-jobs
│   └── orchestrator.ts      # Lắng nghe job done, update Order
├── services/
│   ├── account-pool.ts      # Lease/release acc với cooldown
│   ├── proxy-pool.ts        # Health check, gán proxy
│   ├── worker-registry.ts   # Track worker capacity
│   ├── order-service.ts     # CRUD order + state machine
│   └── webhook-service.ts   # Notify client khi xong
├── db/
│   ├── schema.ts            # Drizzle schema
│   ├── migrations/          # SQL migration
│   └── client.ts
├── cron/
│   ├── proxy-healthcheck.ts # Mỗi 30p
│   ├── acc-warmup-scheduler.ts # Mỗi giờ
│   ├── stale-worker-cleanup.ts # Mỗi 1p
│   └── daily-report.ts      # 8h sáng
└── config.ts                # Load env
```

### Endpoints chính

```
POST   /orders                    # Tạo order
GET    /orders/:id
GET    /orders                    # list, filter

POST   /accounts/import           # Bulk import CSV
GET    /accounts                  # filter theo status, tier
POST   /accounts/lease            # Worker xin acc
POST   /accounts/release          # Worker trả acc
POST   /accounts/:id/quarantine   # Đánh dấu lỗi

POST   /proxies/import
GET    /proxies
POST   /proxies/healthcheck

POST   /workers/register
POST   /workers/:id/heartbeat
GET    /workers

GET    /jobs                       # log query
GET    /metrics                    # Prometheus exposition
```

---

## apps/worker

**Mục đích**: Agent chạy trên mỗi máy worker.

### Cấu trúc

```
apps/worker/src/
├── index.ts                 # Entry: register + start consumer
├── agent.ts                 # Heartbeat, capacity report
├── consumers/
│   ├── live-view.consumer.ts
│   ├── live-comment.consumer.ts
│   ├── live-like.consumer.ts
│   ├── live-cart.consumer.ts
│   ├── video-view.consumer.ts
│   ├── video-action.consumer.ts
│   ├── follow.consumer.ts
│   ├── warmup.consumer.ts
│   └── register.consumer.ts
├── runtime/
│   ├── slot-manager.ts      # Quản lý 60 slot, không vượt giới hạn
│   ├── profile-runner.ts    # Wrapper: start GPM + run fn + close
│   └── error-handler.ts     # Phân loại lỗi → retry/quarantine
├── api-client.ts            # Gọi master API (lease acc, report)
└── config.ts
```

### Job execution pattern

```ts
async function runLiveViewJob(job: Job<LiveViewPayload>) {
  const acc = await api.leaseAccount({ tier: 'warmed' });
  if (!acc) throw new Error('NO_ACC_AVAILABLE');

  return profileRunner.run(acc.profileId, async (browser, page) => {
    await tiktok.auth.loginByCookie(page, acc.cookie);
    await tiktok.live.enterLive(page, job.data.url);
    await tiktok.live.watchLive(page, job.data.duration);
    return { ok: true };
  }).finally(() => api.releaseAccount(acc.id, { cooldownMin: 30 }));
}
```

---

## apps/dashboard

**Mục đích**: Web UI quản lý.

### Stack
- Next.js 14 (App Router)
- shadcn/ui components
- TailwindCSS
- TanStack Query cho data fetching
- Recharts cho biểu đồ

### Pages

| Route | Mô tả |
|---|---|
| `/` | Overview KPI + recent orders |
| `/orders` | List + create + detail |
| `/orders/new` | Form đặt order |
| `/accounts` | Pool acc + bulk import |
| `/accounts/:id` | Chi tiết acc, log action |
| `/proxies` | Pool proxy + health |
| `/workers` | Status 7 máy, restart |
| `/jobs` | Log full-text search |
| `/settings` | API key, webhook URL, alert config |

---

## scripts/

| Script | Mục đích |
|---|---|
| `seed-db.ts` | Tạo schema + seed dữ liệu mẫu |
| `import-accounts.ts` | Bulk import từ CSV |
| `import-proxies.ts` | Bulk import proxy |
| `gpm-sync.ts` | Đồng bộ profile từ GPM Login về DB |
| `healthcheck-all.ts` | Run health check đồng loạt |
| `migrate-cookies.ts` | Migrate cookie format khi đổi schema |

---

## Dependency graph giữa các package

```
shared  ←──────────────┐
   ▲                   │
   │                   │
gpm-client             │
   ▲                   │
   │                   │
tiktok-actions ────────┤
   ▲                   │
   ├───────────────────┤
   │                   │
apps/master       apps/worker       apps/dashboard
                                          │
                                          └──> apps/master (REST)
```

---

## Coding convention

- TypeScript strict mode bật.
- Mọi async function có timeout (default 60s).
- Mọi external call wrap trong `try/catch` với phân loại error code.
- Không `console.log`, dùng pino logger với context.
- Test framework: **vitest** cho unit test, **playwright test** cho integration trên TikTok (nếu cần).
- Commit: conventional commits (`feat:`, `fix:`, `chore:`).
