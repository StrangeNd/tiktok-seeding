import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Spinner, StatusBadge, fmtRelTime } from '../components/ui';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toast';

interface OrderRow {
  id: number;
  type: string;
  targetUrl: string;
  count: number;
  watchSeconds: number;
  spreadSeconds: number;
  status: string;
  completedJobs: number;
  failedJobs: number;
  createdAt: string;
  completedAt: string | null;
}

export function Orders() {
  const [open, setOpen] = useState(false);
  const list = useFetch<{ orders: OrderRow[] }>('/orders', { intervalMs: 10_000 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-text-muted">
            Each order spawns N sub-jobs, one per leased profile.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          New order
        </button>
      </div>

      <Card pad={false}>
        {list.loading && !list.data ? (
          <div className="p-10 text-center text-text-muted">
            <Spinner /> loading…
          </div>
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            hint="Create your first order to start a seeding run."
            action={
              <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
                New order
              </button>
            }
          />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Target</th>
                <th>Count / Watch</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-xs">#{o.id}</td>
                  <td className="max-w-[320px] truncate" title={o.targetUrl}>
                    {o.targetUrl}
                  </td>
                  <td className="text-text-muted">
                    {o.count} × {o.watchSeconds}s
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    <ProgressBar done={o.completedJobs} failed={o.failedJobs} total={o.count} />
                  </td>
                  <td className="text-text-muted">{fmtRelTime(o.createdAt)}</td>
                  <td>
                    <Link to={`/orders/${o.id}`} className="btn text-xs">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {open && (
        <NewOrderModal
          onClose={(reload) => {
            setOpen(false);
            if (reload) list.reload();
          }}
        />
      )}
    </div>
  );
}

function ProgressBar({ done, failed, total }: { done: number; failed: number; total: number }) {
  const pctDone = total ? (done / total) * 100 : 0;
  const pctFail = total ? (failed / total) * 100 : 0;
  return (
    <div className="w-40">
      <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden flex">
        <div className="h-full bg-ok" style={{ width: `${pctDone}%` }} />
        <div className="h-full bg-danger" style={{ width: `${pctFail}%` }} />
      </div>
      <div className="text-xs text-text-subtle mt-1">
        {done}/{total}
        {failed > 0 ? <span className="text-danger ml-1">· {failed} fail</span> : null}
      </div>
    </div>
  );
}

function NewOrderModal({ onClose }: { onClose: (reload?: boolean) => void }) {
  const [targetUrl, setTargetUrl] = useState('https://www.tiktok.com/@tiktok/live');
  const [count, setCount] = useState(2);
  const [watchSeconds, setWatch] = useState(20);
  const [spreadSeconds, setSpread] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ orderId: number; jobsCreated: number }>('/orders', {
        method: 'POST',
        body: {
          type: 'live_view',
          targetUrl,
          count: Number(count),
          watchSeconds: Number(watchSeconds),
          spreadSeconds: Number(spreadSeconds),
        },
      });
      toast.success(`Order #${r.orderId} created`, `${r.jobsCreated} jobs dispatched`);
      onClose(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6">
      <div className="card w-[560px] max-w-full">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-base font-semibold">New order</div>
          <button type="button" className="btn-ghost" onClick={() => onClose()}>
            ✕
          </button>
        </header>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="target-url" className="label">
              Target URL
            </label>
            <input
              id="target-url"
              className="input font-mono text-xs"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="count" className="label">
                Count
              </label>
              <input
                id="count"
                type="number"
                min={1}
                max={500}
                className="input"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="watch-s" className="label">
                Watch (s)
              </label>
              <input
                id="watch-s"
                type="number"
                min={10}
                max={3600}
                className="input"
                value={watchSeconds}
                onChange={(e) => setWatch(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="spread-s" className="label">
                Spread (s)
              </label>
              <input
                id="spread-s"
                type="number"
                min={0}
                max={600}
                className="input"
                value={spreadSeconds}
                onChange={(e) => setSpread(Number(e.target.value))}
              />
            </div>
          </div>
          {err && (
            <div className="border border-danger/40 bg-danger/10 text-danger px-3 py-2 rounded-md text-sm">
              {err}
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
          <button type="button" className="btn" onClick={() => onClose()} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy && <Spinner />}
            Create order
          </button>
        </footer>
      </div>
    </div>
  );
}
