# SCHEMA — Database design

ORM: **Drizzle**. DB: **PostgreSQL 14+**.

Phase 1 MVP uses a compact schema: profiles, orders, jobs, workers, accounts,
and proxies. Sensitive account/proxy material is stored in encrypted blobs.

> Note: the older long-form tables below remain the Phase 2+ target model. The
> current implemented additions for dashboard/account/proxy/mail-code are listed
> first.

---

## Current dashboard tables

### `accounts`

| Column | Type | Note |
|---|---|---|
| `id` | serial PK | Local account id. |
| `username` | text | TikTok username/login identifier. |
| `email` | text | Mailbox address attached to the account. |
| `status` | text | `active | disabled | broken | quarantined | archived`. |
| `secret_blob` | text | AES-256-GCM encrypted JSON (`pass`, `passmail`, `refreshtokenmail`, `clientid`, `cookie`). |
| `has_password` | int flag | Presence flag only. |
| `has_email_password` | int flag | Legacy mailbox password presence; not used if OAuth refresh token exists. |
| `has_mail_refresh_token` | int flag | Mailbox OAuth2 refresh token presence. |
| `has_mail_client_id` | int flag | Mailbox OAuth2 client id presence. |
| `has_cookie` | int flag | TikTok cookie/session material presence. |
| `cookie_status` | text | `unknown | present | missing | needs_reauth | dead`. |
| `last_mail_code_status` | text | `ok | missing_oauth | token_failed | code_not_found | provider_unsupported | rate_limited | error`. |
| `last_mail_code_error` | text | Sanitized/actionable error only; no secrets. |
| `last_mail_code_checked_at` | timestamptz | Last manual mailbox-code request. |
| `last_error`, `last_checked_at` | text/timestamptz | General account health bookkeeping. |
| `created_at`, `updated_at` | timestamptz | Row timestamps. |

Security invariant: API responses never include `secret_blob` or decrypted
values. Dashboard displays only masked email and presence flags. Mail-code
retrieval decrypts OAuth2 fields in memory only after a manual operator click.

### `proxies`

| Column | Type | Note |
|---|---|---|
| `id` | serial PK | Local proxy id. |
| `protocol` | text | `http | https | socks5 | socks4`. |
| `host`, `port` | text/int | Proxy endpoint. |
| `username` | text | Optional username. |
| `secret_blob` | text | AES-256-GCM encrypted proxy password JSON. |
| `has_auth` | int flag | Proxy auth presence. |
| `status` | text | `unknown | ok | failed | disabled`. |
| `latency_ms` | int | Last neutral TCP probe latency. |
| `last_error`, `last_checked_at` | text/timestamptz | Sanitized probe result. |
| `created_at`, `updated_at` | timestamptz | Row timestamps. |

Proxy connectivity checks are neutral reachability probes and are not
platform-specific.

---

## 1. ENUM

```sql
account_status:  active | warming | cooldown | quarantine | banned | logged_out
account_tier:    fresh | warmed | aged | vip
proxy_type:      datacenter | residential | mobile_4g
proxy_status:    active | dead | unchecked
profile_status:  ready | running | broken | retired
job_type:        live_view | live_comment | live_like | live_cart_click |
                 video_view | video_like | video_comment | video_share |
                 follow | warmup_daily | register
job_status:      queued | assigned | running | success | failed | cancelled | retrying
order_status:    queued | running | done | partial | cancelled | failed
worker_status:   online | offline | busy | maintenance
```

---

## 2. TABLES

### 2.1 `accounts`
TK TikTok.

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| username | varchar(64) UNIQUE | TikTok username |
| password_enc | text | AES-GCM ciphertext |
| email | varchar(128) | nullable |
| phone | varchar(32) | nullable |
| tiktok_uid | varchar(64) | id thật từ TikTok, lấy sau login |
| cookie_enc | text | session cookie, encrypt |
| status | account_status | mặc định `fresh` → `warming` |
| tier | account_tier | |
| health_score | int | 0–100, default 100 |
| follower_count | int | cập nhật khi warmup |
| following_count | int | |
| birthday | date | dùng khi reg |
| profile_id | bigint FK → gpm_profiles | sticky 1:1 |
| proxy_id | bigint FK → proxies | sticky 1:1 |
| last_active_at | timestamptz | lần cuối dùng |
| cooldown_until | timestamptz | trước thời điểm này không lease được |
| quarantine_reason | text | |
| metadata | jsonb | bio, avatar_url, language pref... |
| created_at, updated_at, deleted_at | timestamptz | |

Index: `(status, cooldown_until, tier)` — cho query lease nhanh.

### 2.2 `gpm_profiles`
Profile trong GPM Login.

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | local id |
| gpm_id | varchar(64) UNIQUE | id thật từ GPM |
| gpm_group | varchar(64) | group trong GPM |
| worker_id | bigint FK → workers | profile thuộc máy nào |
| status | profile_status | |
| os | varchar(32) | win/mac fingerprint |
| browser_core | varchar(32) | chromium/firefox |
| user_agent | text | |
| last_used_at | timestamptz | |
| created_at, updated_at | timestamptz | |

### 2.3 `proxies`

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| host | varchar(128) | |
| port | int | |
| type | proxy_type | |
| protocol | varchar(16) | http/https/socks5 |
| username | varchar(128) | nullable |
| password_enc | text | nullable |
| country | varchar(8) | ISO, mặc định 'VN' |
| city | varchar(64) | nullable |
| isp | varchar(128) | nullable |
| status | proxy_status | |
| last_check_at | timestamptz | |
| last_check_latency_ms | int | |
| failure_count | int | reset khi check thành công |
| expires_at | timestamptz | nullable, ngày proxy hết hạn |
| metadata | jsonb | |
| created_at, updated_at | timestamptz | |

Index: `(status, type)`.

### 2.4 `workers`

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| name | varchar(64) UNIQUE | worker-1 .. worker-7 |
| host | varchar(128) | LAN IP / Tailscale IP |
| public_ip_pool | varchar(64) | thuộc dải IP nào (1/2/3) |
| capacity | int | mặc định 60 |
| current_load | int | counter |
| status | worker_status | |
| last_heartbeat_at | timestamptz | |
| version | varchar(32) | agent version |
| metadata | jsonb | OS, RAM, CPU info |
| created_at, updated_at | timestamptz | |

### 2.5 `orders`
Đơn hàng từ client.

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| client_id | varchar(64) | API key issuer |
| type | job_type | |
| target_url | text | url live / video |
| target_username | varchar(64) | nullable, cho follow |
| count | int | số lượng yêu cầu |
| duration_sec | int | nullable, cho live_view |
| comment_pool | jsonb | array text comment có thể dùng |
| schedule_at | timestamptz | nullable, lên lịch |
| webhook_url | text | nullable |
| status | order_status | |
| completed | int | counter realtime |
| failed | int | |
| metadata | jsonb | |
| created_at, updated_at, completed_at | timestamptz | |

### 2.6 `jobs`
Sub-job của order.

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| order_id | bigint FK → orders | nullable cho warmup/reg |
| bullmq_id | varchar(64) | id của BullMQ |
| type | job_type | |
| account_id | bigint FK → accounts | nullable trước assign |
| worker_id | bigint FK → workers | nullable trước assign |
| status | job_status | |
| payload | jsonb | params đầy đủ |
| result | jsonb | nullable |
| error_code | varchar(64) | |
| error_message | text | |
| attempt | int | default 1 |
| started_at | timestamptz | |
| ended_at | timestamptz | |
| created_at, updated_at | timestamptz | |

Index: `(status, type)`, `(order_id)`, `(account_id, ended_at)`.

### 2.7 `account_actions`
Audit log mọi action chạy trên acc → tính health_score + behavior pattern.

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| account_id | bigint FK | |
| job_id | bigint FK | nullable |
| action | varchar(32) | login, like, comment, watch_live... |
| target | text | url/username |
| ok | bool | |
| latency_ms | int | |
| details | jsonb | |
| created_at | timestamptz | |

Partition theo tháng (Postgres) khi prod để khỏi phình.

### 2.8 `comment_templates`
Pool comment để random.

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| category | varchar(64) | live_general, product, hype, ask_price... |
| language | varchar(8) | vi/en |
| text | text | |
| weight | int | trọng số random |
| last_used_at | timestamptz | |
| use_count | int | |

### 2.9 `webhooks_log`

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| order_id | bigint FK | |
| url | text | |
| payload | jsonb | |
| status_code | int | |
| response_body | text | |
| attempt | int | |
| created_at | timestamptz | |

### 2.10 `api_keys`

| Column | Type | Note |
|---|---|---|
| id | bigserial PK | |
| name | varchar(64) | |
| key_hash | varchar(128) | sha256 |
| client_id | varchar(64) | |
| permissions | jsonb | array of scope |
| rate_limit_per_min | int | |
| revoked_at | timestamptz | |
| created_at | timestamptz | |

---

## 3. Quan hệ chính

```
orders 1───┬───n jobs
           │
jobs n────1 accounts 1────1 gpm_profiles
              │                    │
              └────1 proxies       └────n workers
                                          │
                                          └── (1 worker chứa nhiều profile)

account_actions n──1 accounts (audit)
```

---

## 4. Query mẫu (lease account)

```sql
-- Worker xin 1 acc warmed, không trong cooldown, ưu tiên ít dùng gần nhất
SELECT a.*
FROM accounts a
WHERE a.status = 'active'
  AND a.tier IN ('warmed', 'aged', 'vip')
  AND (a.cooldown_until IS NULL OR a.cooldown_until <= NOW())
  AND a.health_score >= 60
  AND a.profile_id IS NOT NULL
  AND a.proxy_id IS NOT NULL
  AND a.deleted_at IS NULL
ORDER BY a.last_active_at ASC NULLS FIRST
LIMIT 1
FOR UPDATE SKIP LOCKED;  -- Postgres concurrency-safe
```

---

## 5. Migration strategy

- **Phase 1** SQLite: 1 file `data.db`, drizzle migration rebuild dễ.
- **Phase 2 trở đi** Postgres: dùng `drizzle-kit generate` + `drizzle-kit migrate`.
- Backup hằng ngày: `pg_dump --format=custom`, lưu 30 ngày, copy sang ổ ngoài.
- Critical fields cần encrypt key rotation policy: 90 ngày 1 lần (chỉ encrypt lại cookie + password).
