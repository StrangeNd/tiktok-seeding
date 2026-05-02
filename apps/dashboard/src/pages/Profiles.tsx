import { useState } from 'react';
import { Card, EmptyState, ErrorState, Spinner, StatusBadge, fmtRelTime } from '../components/ui';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toast';

interface ProfileRow {
  id: string;
  name: string;
  browserType: string | null;
  groupId: string | null;
  status: string;
  lastUsedAt: string | null;
  syncedAt: string;
}

export function Profiles() {
  const [statusFilter, setStatusFilter] = useState('');
  const path = `/profiles${statusFilter ? `?status=${statusFilter}` : ''}`;
  const list = useFetch<{ items: ProfileRow[]; total: number }>(path, { intervalMs: 15_000 });
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await api<{ pulled?: number; upserted?: number }>('/admin/sync-profiles', {
        method: 'POST',
      });
      toast.success('Profile sync completed', JSON.stringify(r));
      list.reload();
    } catch (e) {
      toast.error('Profile sync failed', (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Profiles</h1>
          <p className="text-sm text-text-muted">
            GPM browser profile pool, mirrored from GPM Login.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="available">available</option>
            <option value="in_use">in_use</option>
            <option value="broken">broken</option>
            <option value="quarantined">quarantined</option>
          </select>
          <button type="button" className="btn-primary" onClick={syncNow} disabled={syncing}>
            {syncing && <Spinner />}
            Sync from GPM
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
            title="No profiles yet"
            hint="Click Sync from GPM to pull your local profile pool into the database."
          />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Browser</th>
                <th>Group</th>
                <th>Last used</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">
                    <div>{p.name}</div>
                    <div className="text-xs text-text-subtle font-mono">{p.id.slice(0, 8)}</div>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="text-text-muted">{p.browserType ?? '—'}</td>
                  <td className="text-text-muted">{p.groupId ?? '—'}</td>
                  <td className="text-text-muted">{fmtRelTime(p.lastUsedAt)}</td>
                  <td className="text-text-muted">{fmtRelTime(p.syncedAt)}</td>
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
    </div>
  );
}
