import { Card, ErrorState, Spinner, fmtRelTime } from '../components/ui';
import { useFetch } from '../lib/useFetch';

interface AuditRow {
  id: number;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

export function AuditLogs() {
  const logs = useFetch<{ items: AuditRow[]; total: number }>('/audit-logs', {
    intervalMs: 30_000,
  });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <p className="text-sm text-text-muted">
          Safe operational audit trail. Secret fields are redacted before storage.
        </p>
      </div>
      <Card pad={false}>
        {logs.loading && !logs.data ? (
          <div className="p-10">
            <Spinner /> loading…
          </div>
        ) : logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.reload} />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.items.map((row) => (
                <tr key={row.id}>
                  <td className="text-text-muted">{fmtRelTime(row.createdAt)}</td>
                  <td>{row.actorUsername ?? 'system'}</td>
                  <td className="font-mono text-xs">{row.action}</td>
                  <td className="text-text-muted">
                    {row.entityType}
                    {row.entityId ? ` #${row.entityId}` : ''}
                  </td>
                  <td
                    className="font-mono text-xs max-w-[420px] truncate"
                    title={JSON.stringify(row.metadata ?? {})}
                  >
                    {JSON.stringify(row.metadata ?? {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
