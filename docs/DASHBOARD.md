# Dashboard Operator Guide

The dashboard is a local operator console for the master API. It helps manage profiles, accounts, proxies, orders, jobs, and safe recovery flows without touching source code.

## Start

```powershell
pnpm build:dashboard
pnpm start:all
```

Open <http://127.0.0.1:7000/dashboard/> and sign in with `MASTER_API_KEY` from your local `.env`.

For development only, `pnpm dashboard` still starts the Vite dev server on `DASHBOARD_PORT` (default `5173`).

## Pages

| Page | Purpose |
|---|---|
| Overview | Health, worker status, profile/account/proxy/order summaries. |
| Profiles | Sync and inspect GPM profile pool. |
| Accounts | Import owned account records, inspect safe presence flags, retrieve mailbox codes manually. |
| Proxies | Import proxies and run neutral TCP connectivity checks. |
| Orders | Create and inspect live-view orders. |
| Activity | Recent jobs across orders. |
| Admin | Health checks and safe recovery actions. |
| Settings | Master URL/API-key local browser settings and security reminders. |

## Account import format

One account per line:

```text
username|pass|mail|passmail|refreshtokenmail|clientid|cookie
```

Field meanings:

| Field | Meaning | Storage/API behavior |
|---|---|---|
| `username` | TikTok username/login identifier | Stored plaintext for operator lookup. |
| `pass` | TikTok password | Encrypted in `secret_blob`; never returned. |
| `mail` | Email address attached to the account | Stored as email; API returns masked display plus the email field for internal operator context. |
| `passmail` | Legacy email password | Encrypted; not used when OAuth2 refresh token exists. |
| `refreshtokenmail` | OAuth2 refresh token for the mailbox | Encrypted; never returned. |
| `clientid` | OAuth2 client id | Encrypted with other secrets; never returned. |
| `cookie` | TikTok cookie/session material | Encrypted; never returned. |

The import preview shows only presence flags (`hasPassword`, `hasMailRefreshToken`, etc.), invalid rows, duplicate usernames, and duplicate emails. It never echoes raw secret values.

## Proxy import format

Supported formats:

```text
host:port
host:port:username:password
http://host:port
http://username:password@host:port
socks5://username:password@host:port
```

Proxy passwords are encrypted and never returned by the API. Connectivity checks use a generic TCP reachability probe and do not target TikTok or any platform-specific endpoint.

## Mailbox OAuth2 code retrieval

This feature is for inboxes/accounts you own or are authorized to operate.

What it does:

1. Operator opens **Accounts → Detail**.
2. Operator clicks **Get mail code**.
3. Master decrypts the mailbox OAuth2 refresh token/client id in memory only.
4. Provider adapter exchanges refresh token for a mailbox access token.
5. Provider adapter searches recent inbox messages within `MAIL_CODE_LOOKBACK_MINUTES`.
6. The service extracts the first conservative 4-8 digit code from subject/body preview.
7. API returns only:
   - `code`
   - masked source email
   - subject snippet
   - received timestamp
   - provider name

What it does **not** do:

- It does not automate TikTok login.
- It does not submit codes anywhere.
- It does not bypass platform controls.
- It does not expose OAuth tokens, passwords, cookies, proxy credentials, or full email bodies.

## Mail configuration

Local `.env` keys:

```env
CREDENTIALS_ENCRYPTION_KEY=change-me-32-plus-chars
MAIL_PROVIDER=custom
MAIL_CODE_LOOKBACK_MINUTES=15
MAIL_CODE_MAX_RESULTS=10
MAIL_CODE_ALLOWED_SENDERS=
MAIL_CODE_SUBJECT_HINTS=code,verification,verify,security
MAIL_CODE_REQUEST_COOLDOWN_SECONDS=30
```

Provider notes:

- `custom` is the safe default. It returns `provider_unsupported` and performs no external mailbox calls.
- `microsoft` uses Microsoft OAuth2 token refresh and Microsoft Graph inbox message search.
- `gmail` is reserved for a future adapter and currently returns `provider_unsupported`.

For Microsoft Graph, the imported account row must include `refreshtokenmail` and `clientid` generated for an OAuth app that can read that owned mailbox. Do not commit or paste real tokens into chat.

## Troubleshooting

| Error | Meaning | Action |
|---|---|---|
| `missing_oauth` | Account lacks email, refresh token, or client id. | Re-import/update the account locally with mailbox OAuth2 fields. |
| `provider_unsupported` | `MAIL_PROVIDER` is `custom`, `gmail`, or unsupported. | Set `MAIL_PROVIDER=microsoft` for Microsoft Graph, then restart master. |
| `token_failed` | Refresh token exchange failed. | Token may be revoked/expired, client id may be wrong, or app scopes may be insufficient. |
| `code_not_found` | No 4-8 digit code found in recent messages. | Increase lookback, verify subject/sender filters, or manually inspect owned mailbox. |
| `rate_limited` | Too many manual requests in a short interval. | Wait `MAIL_CODE_REQUEST_COOLDOWN_SECONDS`. |
| Decryption failure | `CREDENTIALS_ENCRYPTION_KEY` changed after import. | Restore original key or re-import secrets. |

## Security checklist

- Never commit `.secrets/` real files.
- Never commit `.env`.
- Never paste real credentials into chat, issues, logs, or docs.
- Rotate `CREDENTIALS_ENCRYPTION_KEY` only with a migration/re-import plan.
- Keep the dashboard local unless you add proper network authentication/TLS.
- Validate real mailbox OAuth2 only on your machine with owned accounts.
