import { useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorState,
  MaskedFlag,
  Spinner,
  StatusBadge,
  fmtRelTime,
} from '../components/ui';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toast';

interface SafeAccount {
  id: number;
  username: string;
  email: string | null;
  maskedEmail: string | null;
  status: string;
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasMailRefreshToken: boolean;
  hasMailClientId: boolean;
  hasCookie: boolean;
  cookieStatus: string;
  lastMailCodeStatus: string | null;
  lastMailCodeError: string | null;
  lastMailCodeCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface SafeParsedRow {
  rowNumber: number;
  ok: boolean;
  reason?: string;
  username?: string;
  email?: string;
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasMailRefreshToken: boolean;
  hasMailClientId: boolean;
  hasCookie: boolean;
  duplicate?: 'username_input' | 'email_input' | 'username_db' | 'email_db';
}

interface ParsePreview {
  total: number;
  valid: number;
  invalid: number;
  duplicateUsernamesInInput: number;
  duplicateEmailsInInput: number;
  duplicateUsernamesInDb: number;
  duplicateEmailsInDb: number;
  rows: SafeParsedRow[];
}

interface MailCodeResult {
  code: string;
  maskedSourceEmail: string | null;
  subjectSnippet: string;
  receivedAt: string;
  provider: string;
}

export function Accounts() {
  const [statusFilter, setStatusFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<SafeAccount | null>(null);
  const path = `/accounts${statusFilter ? `?status=${statusFilter}` : ''}`;
  const list = useFetch<{ items: SafeAccount[]; total: number }>(path, { intervalMs: 30_000 });

  async function setStatus(id: number, status: string) {
    try {
      await api(`/accounts/${id}/status`, { method: 'POST', body: { status } });
      toast.success('Status updated', `Account #${id} → ${status}`);
      list.reload();
    } catch (e) {
      toast.error('Update failed', (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-text-muted">
            Use only for inboxes/accounts you own or are authorized to operate. Mail code retrieval
            helps manual re-authentication; it does not automatically log in or bypass platform
            controls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
            <option value="broken">broken</option>
            <option value="quarantined">quarantined</option>
            <option value="archived">archived</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
            Import accounts
          </button>
        </div>
      </div>

      <Card pad={false}>
        {list.loading && !list.data ? (
          <div className="p-10 text-center text-text-muted">
            <Spinner /> loading…
          </div>
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            hint="Use Import accounts to paste fake/local account rows. Never paste real secrets into chat or commit them."
            action={
              <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
                Import accounts
              </button>
            }
          />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Username</th>
                <th>Email</th>
                <th>Status</th>
                <th>Cookie</th>
                <th>Mailbox OAuth2</th>
                <th>Last code check</th>
                <th>Last error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="text-text-subtle font-mono">{a.id}</td>
                  <td className="font-medium">{a.username}</td>
                  <td className="text-text-muted">{a.maskedEmail ?? a.email ?? '—'}</td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={a.cookieStatus} />
                      <MaskedFlag has={a.hasCookie} label="cookie" />
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <MaskedFlag has={a.hasMailRefreshToken} label="refresh" />
                      <MaskedFlag has={a.hasMailClientId} label="client" />
                    </div>
                  </td>
                  <td className="text-text-muted">{fmtRelTime(a.lastMailCodeCheckedAt)}</td>
                  <td
                    className="text-xs text-text-muted max-w-[220px] truncate"
                    title={a.lastMailCodeError ?? a.lastError ?? ''}
                  >
                    {a.lastMailCodeError ?? a.lastError ?? '—'}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <select
                        className="input w-32 text-xs"
                        value={a.status}
                        onChange={(e) => setStatus(a.id, e.target.value)}
                      >
                        <option value="active">active</option>
                        <option value="disabled">disabled</option>
                        <option value="broken">broken</option>
                        <option value="quarantined">quarantined</option>
                        <option value="archived">archived</option>
                      </select>
                      <button type="button" className="btn text-xs" onClick={() => setSelected(a)}>
                        Detail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {list.data && (
        <div className="text-xs text-text-subtle">
          Showing {list.data.items.length} of {list.data.total}
        </div>
      )}

      {importOpen && (
        <ImportAccountsModal
          onClose={() => {
            setImportOpen(false);
            list.reload();
          }}
        />
      )}
      {selected && (
        <AccountDetailDrawer
          account={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function AccountDetailDrawer({
  account,
  onClose,
  onUpdated,
}: {
  account: SafeAccount;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<MailCodeResult | null>(null);

  async function getMailCode() {
    setBusy('code');
    setResult(null);
    try {
      const r = await api<MailCodeResult>(`/accounts/${account.id}/mail-code`, { method: 'POST' });
      setResult(r);
      toast.success('Mail code retrieved', `Provider: ${r.provider}`);
      onUpdated();
    } catch (e) {
      toast.error('Mail code failed', (e as Error).message);
      onUpdated();
    } finally {
      setBusy(null);
    }
  }

  async function setCookieStatus(cookieStatus: 'dead' | 'needs_reauth') {
    setBusy(cookieStatus);
    try {
      await api(`/accounts/${account.id}/status`, { method: 'PATCH', body: { cookieStatus } });
      toast.success('Cookie status updated', cookieStatus);
      onUpdated();
      onClose();
    } catch (e) {
      toast.error('Update failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex justify-end">
      <aside className="w-[460px] max-w-full h-full bg-bg-subtle border-l border-border shadow-xl overflow-y-auto">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">{account.username}</div>
            <div className="text-xs text-text-muted">{account.maskedEmail ?? 'no email'}</div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="p-5 space-y-5">
          <Card title="Safe details">
            <div className="space-y-3 text-sm">
              <Info label="Account status" value={<StatusBadge status={account.status} />} />
              <Info label="Cookie status" value={<StatusBadge status={account.cookieStatus} />} />
              <Info label="Last code status" value={account.lastMailCodeStatus ?? '—'} />
              <Info label="Last code checked" value={fmtRelTime(account.lastMailCodeCheckedAt)} />
              <div className="flex flex-wrap gap-1 pt-1">
                <MaskedFlag has={account.hasPassword} label="pass" />
                <MaskedFlag has={account.hasEmailPassword} label="mailpw" />
                <MaskedFlag has={account.hasMailRefreshToken} label="refresh" />
                <MaskedFlag has={account.hasMailClientId} label="client" />
                <MaskedFlag has={account.hasCookie} label="cookie" />
              </div>
              {account.lastMailCodeError && (
                <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded p-2">
                  {account.lastMailCodeError}
                </div>
              )}
            </div>
          </Card>

          <Card title="Manual mailbox code retrieval">
            <div className="text-xs text-text-muted mb-3">
              This only reads recent messages from the account's own mailbox and displays a code for
              the operator. It does not submit the code anywhere.
            </div>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={getMailCode}
              disabled={busy === 'code' || !account.hasMailRefreshToken || !account.hasMailClientId}
            >
              {busy === 'code' && <Spinner />}
              Get mail code
            </button>
            {(!account.hasMailRefreshToken || !account.hasMailClientId) && (
              <div className="text-xs text-warn mt-2">
                Missing mailbox OAuth2 refresh token or client id.
              </div>
            )}
            {result && (
              <div className="mt-4 border border-brand/30 bg-brand/10 rounded-md p-4">
                <div className="text-xs text-text-muted uppercase tracking-wide">
                  Retrieved code
                </div>
                <div className="text-4xl font-semibold tracking-widest mt-1">{result.code}</div>
                <div className="text-xs text-text-muted mt-2 space-y-0.5">
                  <div>From: {result.maskedSourceEmail ?? '—'}</div>
                  <div>Subject: {result.subjectSnippet || '—'}</div>
                  <div>Received: {fmtRelTime(result.receivedAt)}</div>
                </div>
              </div>
            )}
          </Card>

          <Card title="Re-auth workflow">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => setCookieStatus('needs_reauth')}
                disabled={busy === 'needs_reauth'}
              >
                {busy === 'needs_reauth' && <Spinner />}
                Needs reauth
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => setCookieStatus('dead')}
                disabled={busy === 'dead'}
              >
                {busy === 'dead' && <Spinner />}
                Mark cookie dead
              </button>
            </div>
          </Card>
        </div>
      </aside>
    </div>
  );
}

function ImportAccountsModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function doPreview() {
    setBusy(true);
    try {
      const r = await api<ParsePreview>('/accounts/import/preview', {
        method: 'POST',
        body: { text },
      });
      setPreview(r);
    } catch (e) {
      toast.error('Preview failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api<{ inserted: number; skipped: number; total: number }>(
        '/accounts/import',
        { method: 'POST', body: { text, confirm: true } },
      );
      toast.success('Import complete', `${r.inserted} inserted, ${r.skipped} skipped`);
      onClose();
    } catch (e) {
      toast.error('Import failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const duplicateTotal = preview
    ? preview.duplicateUsernamesInInput +
      preview.duplicateEmailsInInput +
      preview.duplicateUsernamesInDb +
      preview.duplicateEmailsInDb
    : 0;

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6">
      <div className="card w-[1100px] max-w-full max-h-[90vh] flex flex-col">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="text-base font-semibold">Import accounts</div>
            <div className="text-xs text-text-muted mt-0.5">
              Format:{' '}
              <span className="kbd">
                username|pass|mail|passmail|refreshtokenmail|clientid|cookie
              </span>
              . Secrets are encrypted before storage and never echoed back.
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="p-6 overflow-y-auto space-y-4">
          <textarea
            className="input font-mono text-xs h-48"
            placeholder="Paste your account list here, one per line..."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={doPreview}
              disabled={busy || !text.trim()}
            >
              {busy && <Spinner />}
              Preview
            </button>
            <div className="text-xs text-text-subtle">
              Do not paste real credentials into chat. This import preview displays presence flags
              only.
            </div>
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-6 gap-3">
                <Stat label="Total" value={preview.total} />
                <Stat label="Valid" value={preview.valid} tone="ok" />
                <Stat
                  label="Invalid"
                  value={preview.invalid}
                  tone={preview.invalid ? 'danger' : 'default'}
                />
                <Stat
                  label="Dup user"
                  value={preview.duplicateUsernamesInInput + preview.duplicateUsernamesInDb}
                  tone={
                    preview.duplicateUsernamesInInput + preview.duplicateUsernamesInDb
                      ? 'warn'
                      : 'default'
                  }
                />
                <Stat
                  label="Dup email"
                  value={preview.duplicateEmailsInInput + preview.duplicateEmailsInDb}
                  tone={
                    preview.duplicateEmailsInInput + preview.duplicateEmailsInDb
                      ? 'warn'
                      : 'default'
                  }
                />
                <Stat label="New" value={preview.valid - duplicateTotal} tone="ok" />
              </div>
              <Card pad={false} title="Preview">
                <div className="max-h-72 overflow-y-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Pass</th>
                        <th>Mail pw</th>
                        <th>OAuth2 refresh</th>
                        <th>OAuth2 client</th>
                        <th>Cookie</th>
                        <th>Row status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 200).map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="text-text-subtle font-mono">{r.rowNumber}</td>
                          <td>{r.username ?? <span className="text-text-subtle">—</span>}</td>
                          <td className="text-text-muted">{r.email ?? '—'}</td>
                          <td>{r.hasPassword ? <span className="badge-info">yes</span> : '—'}</td>
                          <td>
                            {r.hasEmailPassword ? <span className="badge-info">yes</span> : '—'}
                          </td>
                          <td>
                            {r.hasMailRefreshToken ? <span className="badge-info">yes</span> : '—'}
                          </td>
                          <td>
                            {r.hasMailClientId ? <span className="badge-info">yes</span> : '—'}
                          </td>
                          <td>{r.hasCookie ? <span className="badge-info">yes</span> : '—'}</td>
                          <td>
                            {r.ok ? (
                              <span className="badge-ok">ok</span>
                            ) : (
                              <span className="badge-danger" title={r.reason}>
                                {r.duplicate ? `dup (${r.duplicate})` : (r.reason ?? 'invalid')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.rows.length > 200 && (
                    <div className="px-4 py-3 text-xs text-text-subtle">
                      Showing first 200 of {preview.rows.length} rows.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={doImport}
            disabled={busy || !preview || preview.valid === 0}
          >
            {busy && <Spinner />}
            Confirm import ({preview ? preview.valid - duplicateTotal : 0} new)
          </button>
        </footer>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
}) {
  const cls = {
    default: 'text-text',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-subtle">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
