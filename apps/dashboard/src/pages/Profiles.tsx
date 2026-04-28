import { useState } from 'react';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { fetchProfiles, syncProfiles } from '../lib/api';
import { useFetch } from '../lib/hooks';

export function ProfilesPage() {
  const { data, loading, error, refetch } = useFetch(fetchProfiles);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncProfiles();
      setSyncResult(`Synced ${result.upserted} of ${result.total} profiles`);
      refetch();
    } catch (e) {
      setSyncResult(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  const profiles = data?.profiles ?? [];
  const filtered = filter === 'all' ? profiles : profiles.filter((p) => p.status === filter);

  const statuses = ['all', ...new Set(profiles.map((p) => p.status))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Profiles</h1>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync Profiles'}
        </button>
      </div>

      {syncResult && (
        <div className={`p-3 rounded-md text-sm ${syncResult.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {syncResult}
        </div>
      )}

      <Card
        title={`${filtered.length} profiles`}
        actions={
          <div className="flex gap-1">
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter === s
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400">
            {profiles.length === 0
              ? 'No profiles synced yet. Click "Sync Profiles" to pull from GPM.'
              : 'No profiles match the selected filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Browser</th>
                  <th className="pb-2 font-medium">Group</th>
                  <th className="pb-2 font-medium">Last Used</th>
                  <th className="pb-2 font-medium">Synced</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="py-2">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="py-2 text-gray-500">
                      {p.browserType ?? '—'}
                      {p.browserVersion ? ` ${p.browserVersion}` : ''}
                    </td>
                    <td className="py-2 text-gray-500">{p.groupId ?? '—'}</td>
                    <td className="py-2 text-gray-500">
                      {p.lastUsedAt ? new Date(p.lastUsedAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(p.syncedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
