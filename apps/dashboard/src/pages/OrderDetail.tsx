import { Link, useParams } from 'react-router-dom';
import { Card, ErrorState, Spinner, StatusBadge, fmtDuration, fmtRelTime } from '../components/ui';
import { useFetch } from '../lib/useFetch';

interface OrderDetailData {
  order: {
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
    startedAt: string | null;
    completedAt: string | null;
  };
  jobs: {
    id: number;
    status: string;
    profileId: string;
    attempt: number;
    errorCode: string | null;
    errorMessage: string | null;
    durationMs: number | null;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
}

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const r = useFetch<OrderDetailData>(`/orders/${id}`, { intervalMs: 5_000 });

  if (r.loading && !r.data) {
    return (
      <div className="text-text-muted">
        <Spinner /> loading…
      </div>
    );
  }
  if (r.error) return <ErrorState message={r.error} onRetry={r.reload} />;
  if (!r.data) return null;

  const { order, jobs } = r.data;
  const total = order.count;
  const done = order.completedJobs;
  const failed = order.failedJobs;
  const pending = total - done - failed;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/orders" className="text-xs text-text-muted hover:text-text">
            ← Back to orders
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Order #{order.id}</h1>
          <p className="text-sm text-text-muted break-all">{order.targetUrl}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total" value={total} />
        <Stat label="Succeeded" value={done} tone="ok" />
        <Stat label="Failed" value={failed} tone={failed > 0 ? 'danger' : 'default'} />
        <Stat label="Pending" value={pending} tone={pending > 0 ? 'warn' : 'default'} />
        <Stat label="Watch" value={`${order.watchSeconds}s`} />
      </div>

      <Card title="Jobs" pad={false}>
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Profile</th>
              <th>Status</th>
              <th>Attempt</th>
              <th>Duration</th>
              <th>Error</th>
              <th>Started</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="text-text-subtle font-mono">{j.id}</td>
                <td className="font-mono text-xs">{j.profileId.slice(0, 8)}</td>
                <td>
                  <StatusBadge status={j.status} />
                </td>
                <td className="text-text-muted">{j.attempt}</td>
                <td className="text-text-muted">{fmtDuration(j.durationMs)}</td>
                <td
                  className="text-xs text-text-muted max-w-[260px] truncate"
                  title={j.errorMessage ?? ''}
                >
                  {j.errorCode ? (
                    <span className="badge-danger" title={j.errorMessage ?? ''}>
                      {j.errorCode}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-text-muted">{fmtRelTime(j.startedAt)}</td>
                <td className="text-text-muted">{fmtRelTime(j.finishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
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
  const cls = { default: 'text-text', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[
    tone
  ];
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-subtle">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
