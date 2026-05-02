import { useState } from 'react';
import { Card, EmptyState, ErrorState, Spinner, StatusBadge, fmtRelTime } from '../components/ui';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toast';

interface SafeProxy {
  id: number;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  hasAuth: boolean;
  status: string;
  latencyMs: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SafeProxyParsedRow {
  rowNumber: number;
  ok: boolean;
  reason?: string;
  protocol?: string;
  host?: string;
  port?: number;
  hasAuth: boolean;
  duplicate?: 'input' | 'db';
}
interface ProxyPreview {
  total: number;
  valid: number;
  invalid: number;
  duplicateInInput: number;
  duplicateInDb: number;
  rows: SafeProxyParsedRow[];
}

export function Proxies() {
  const [statusFilter, setStatusFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const path = `/proxies${statusFilter ? `?status=${statusFilter}` : ''}`;
  const list = useFetch<{ items: SafeProxy[]; total: number }>(path, { intervalMs: 30_000 });

  async function testOne(id: number) {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await api(`/proxies/${id}/test-connectivity`, { method: 'POST' });
      list.reload();
    } catch (e) {
      toast.error('Test failed', (e as Error).message);
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function testAll() {
    if (!list.data) return;
    const ids = list.data.items.slice(0, 50).map((p) => p.id);
    if (ids.length === 0) return;
    toast.info(`Testing ${ids.length} proxies…`);
    try {
      await api('/proxies/test-connectivity', { method: 'POST', body: { ids } });
      list.reload();
      toast.success('Connectivity test complete');
    } catch (e) {
      toast.error('Bulk test failed', (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Proxies</h1>
          <p className="text-sm text-text-muted">
            Proxy pool with neutral connectivity probes (does not target any specific platform).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="unknown">unknown</option>
            <option value="ok">ok</option>
            <option value="failed">failed</option>
            <option value="disabled">disabled</option>
          </select>
          <button type="button" className="btn" onClick={testAll}>
            Test all (max 50)
          </button>
          <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
            Import proxies
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
            title="No proxies yet"
            hint="Use Import proxies to paste your proxy list."
            action={
              <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
                Import proxies
              </button>
            }
          />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Proxy</th>
                <th>Auth</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Last error</th>
                <th>Last checked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td className="text-text-subtle font-mono">{p.id}</td>
                  <td className="font-mono text-xs">
                    {p.protocol}://{p.host}:{p.port}
                  </td>
                  <td>
                    {p.hasAuth ? (
                      <span className="badge-info" title={p.username ?? ''}>
                        {p.username ? `${p.username.slice(0, 2)}***` : 'auth'}
                      </span>
                    ) : (
                      <span className="badge-muted">none</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="text-text-muted">
                    {p.latencyMs != null ? `${p.latencyMs}ms` : '—'}
                  </td>
                  <td
                    className="text-xs text-text-muted max-w-[260px] truncate"
                    title={p.lastError ?? ''}
                  >
                    {p.lastError ?? '—'}
                  </td>
                  <td className="text-text-muted">{fmtRelTime(p.lastCheckedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => testOne(p.id)}
                      disabled={busyIds.has(p.id)}
                    >
                      {busyIds.has(p.id) ? <Spinner /> : null}
                      Test
                    </button>
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
        <ImportProxiesModal
          onClose={() => {
            setImportOpen(false);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function ImportProxiesModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ProxyPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function doPreview() {
    setBusy(true);
    try {
      const r = await api<ProxyPreview>('/proxies/import/preview', {
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
      const r = await api<{ inserted: number; skipped: number; total: number }>('/proxies/import', {
        method: 'POST',
        body: { text, confirm: true },
      });
      toast.success('Import complete', `${r.inserted} inserted, ${r.skipped} skipped`);
      onClose();
    } catch (e) {
      toast.error('Import failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6">
      <div className="card w-[900px] max-w-full max-h-[90vh] flex flex-col">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="text-base font-semibold">Import proxies</div>
            <div className="text-xs text-text-muted mt-0.5">
              Supports <span className="kbd">host:port</span>,{' '}
              <span className="kbd">host:port:user:pass</span>,{' '}
              <span className="kbd">protocol://host:port</span>,{' '}
              <span className="kbd">protocol://user:pass@host:port</span>.
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="p-6 overflow-y-auto space-y-4">
          <textarea
            className="input font-mono text-xs h-48"
            placeholder="Paste your proxy list, one per line..."
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
              Passwords are encrypted; the dashboard never displays them.
            </div>
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-3">
                <MiniStat label="Total" value={preview.total} />
                <MiniStat label="Valid" value={preview.valid} ok />
                <MiniStat label="Invalid" value={preview.invalid} danger={preview.invalid > 0} />
                <MiniStat
                  label="Dup (input)"
                  value={preview.duplicateInInput}
                  warn={preview.duplicateInInput > 0}
                />
                <MiniStat
                  label="Dup (db)"
                  value={preview.duplicateInDb}
                  warn={preview.duplicateInDb > 0}
                />
              </div>
              <Card pad={false} title="Preview">
                <div className="max-h-72 overflow-y-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Proxy</th>
                        <th>Auth</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 200).map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="text-text-subtle font-mono">{r.rowNumber}</td>
                          <td className="font-mono text-xs">
                            {r.host && r.port
                              ? `${r.protocol ?? 'http'}://${r.host}:${r.port}`
                              : '—'}
                          </td>
                          <td>{r.hasAuth ? <span className="badge-info">auth</span> : '—'}</td>
                          <td>
                            {r.ok ? (
                              <span className="badge-ok">ok</span>
                            ) : (
                              <span className="badge-danger">
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
            Confirm import (
            {preview ? preview.valid - preview.duplicateInInput - preview.duplicateInDb : 0} new)
          </button>
        </footer>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  ok,
  warn,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  const cls = ok ? 'text-ok' : warn ? 'text-warn' : danger ? 'text-danger' : 'text-text';
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-subtle">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
