import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  StatusBadge,
  fmtDuration,
  fmtRelTime,
} from '../components/ui';
import { useFetch } from '../lib/useFetch';

interface JobRow {
  id: number;
  orderId: number;
  status: string;
  profileId: string;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  workerName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export function Jobs() {
  const [statusFilter, setStatus] = useState('');
  const path = `/jobs${statusFilter ? `?status=${statusFilter}` : ''}`;
  const r = useFetch<{ items: JobRow[]; total: number }>(path, { intervalMs: 5_000 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="text-sm text-text-muted">Recent jobs across all orders.</p>
        </div>
        <select
          className="input w-44"
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="succeeded">succeeded</option>
          <option value="failed">failed</option>
          <option value="retrying">retrying</option>
        </select>
      </div>

      <Card pad={false}>
        {r.loading && !r.data ? (
          <div className="p-10 text-center text-text-muted">
            <Spinner /> loading…
          </div>
        ) : r.error ? (
          <ErrorState message={r.error} onRetry={r.reload} />
        ) : !r.data || r.data.items.length === 0 ? (
          <EmptyState title="No jobs yet" />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Order</th>
                <th>Status</th>
                <th>Worker</th>
                <th>Profile</th>
                <th>Attempt</th>
                <th>Duration</th>
                <th>Error</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {r.data.items.map((j) => (
                <tr key={j.id}>
                  <td className="text-text-subtle font-mono">{j.id}</td>
                  <td>
                    <Link to={`/orders/${j.orderId}`} className="text-brand hover:underline">
                      #{j.orderId}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="text-text-muted">{j.workerName ?? '—'}</td>
                  <td className="font-mono text-xs">{j.profileId.slice(0, 8)}</td>
                  <td className="text-text-muted">{j.attempt}</td>
                  <td className="text-text-muted">{fmtDuration(j.durationMs)}</td>
                  <td className="text-xs max-w-[260px] truncate" title={j.errorMessage ?? ''}>
                    {j.errorCode ? <span className="badge-danger">{j.errorCode}</span> : '—'}
                  </td>
                  <td className="text-text-muted">{fmtRelTime(j.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
