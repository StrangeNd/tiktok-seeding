# `.secrets/` — Operator-only files

This directory holds sensitive operator inputs. **Only `*.example.txt` and this
README are committed.** Everything else under `.secrets/` is gitignored.

## What goes here

| File | Purpose |
|------|---------|
| `accounts.txt` | TikTok account list, pipe-delimited (one per line). |
| `proxies.txt`  | Proxy list, one per line, in any supported format. |
| `accounts.example.txt` | Fake placeholder rows showing the expected format. |
| `proxies.example.txt`  | Fake placeholder rows showing supported proxy formats. |

## Account file format

```
username|pass|mail|passmail|refreshtokenmail|clientid|cookie
```

- `username` is required; everything else is optional.
- Empty fields are allowed: `myuser||mail@x||||`
- Lines starting with `#` and empty lines are ignored.
- Duplicates (by username or email) are detected and skipped at import time.
- `pass`, `passmail`, `refreshtokenmail`, `clientid`, and `cookie` are encrypted
  in Postgres and are never returned by the API.
- If `refreshtokenmail` and `clientid` are present, the dashboard can attempt
  manual mailbox-code retrieval for owned inboxes after operator click.

## Proxy file formats (any of these per line)

```
host:port
host:port:username:password
http://host:port
http://username:password@host:port
socks5://username:password@host:port
```

Supported protocols: `http`, `https`, `socks5`, `socks4`. Unknown protocols are rejected.

## Importing

Use the dashboard:

1. Login at <http://localhost:5173> with your `MASTER_API_KEY`.
2. Open **Accounts → Import** or **Proxies → Import**.
3. Paste the file contents (or copy/paste from `.secrets/accounts.txt`).
4. Review the preview — duplicates, invalid rows, and presence flags are shown.
5. Click **Confirm import** to persist.

## Mail code retrieval

Use only for inboxes/accounts you own or are authorized to operate.

- Configure `.env` (`MAIL_PROVIDER`, lookback, sender/subject filters) locally.
- Default `MAIL_PROVIDER=custom` is disabled and returns `provider_unsupported`.
- `MAIL_PROVIDER=microsoft` uses Microsoft Graph OAuth2 refresh-token flow.
- The API returns only the code, masked source email, subject snippet, timestamp,
  and provider. It never returns OAuth tokens, passwords, cookies, proxy
  credentials, or full email body.
- This feature supports manual re-authentication only. It does not automate
  TikTok login or submit codes anywhere.

## Security rules

- Never commit real credentials. The `.gitignore` is configured to keep `.secrets/`
  out of git, but **double-check `git status` before every commit**.
- Never paste real credentials into chat or issue trackers.
- Real secrets are encrypted with `CREDENTIALS_ENCRYPTION_KEY` (AES-256-GCM)
  before being stored in Postgres. Rotating that key invalidates existing blobs.
- The API never returns plaintext password/cookie/token values — only presence
  flags (`hasPassword`, `hasCookie`, ...).
- The dashboard never displays raw secret values, only masked presence indicators.
