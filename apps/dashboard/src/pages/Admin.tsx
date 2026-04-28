import { useState } from 'react';
import { Card } from '../components/Card';
import { fetchDeepHealth, resetStuckProfiles, syncProfiles } from '../lib/api';
import { useFetch } from '../lib/hooks';

interface ActionResult {
  message: string;
  ok: boolean;
}

function ActionButton({
  label,
  description,
  onAction,
}: {
  label: string;
  description: string;
  onAction: () => Promise<ActionResult>;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleClick() {
    setLoading(true);
    setResult(null);
    try {
      const res = await onAction();
      setResult(res);
    } catch (e) {
      setResult({ message: (e as Error).message, ok: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        {result && (
          <p
            className={`text-xs mt-1 ${result.ok ? 'text-green-600' : 'text-red-600'}`}
          >
            {result.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="shrink-0 bg-gray-900 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? 'Running...' : 'Run'}
      </button>
    </div>
  );
}

export function AdminPage() {
  const health = useFetch(fetchDeepHealth);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-gray-900">Admin &amp; Recovery</h1>

      <Card title="System Health">
        {health.loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : health.error ? (
          <p className="text-sm text-red-600">{health.error}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  health.data?.ok ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {health.data?.ok ? 'All systems operational' : 'System issues detected'}
              </span>
            </div>
            {Object.entries(health.data?.checks ?? {}).map(([name, check]) => (
              <div key={name} className="flex items-center gap-2 ml-5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    check.ok ? 'bg-green-400' : 'bg-red-400'
                  }`}
                />
                <span className="text-sm text-gray-700 capitalize">{name}</span>
                {check.error && (
                  <span className="text-xs text-red-500">({check.error})</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Actions">
        <ActionButton
          label="Sync Profiles"
          description="Pull profiles from GPM and upsert into the database."
          onAction={async () => {
            const r = await syncProfiles();
            return {
              ok: true,
              message: `Synced ${r.upserted} of ${r.total} profiles.`,
            };
          }}
        />
        <ActionButton
          label="Reset Stuck Profiles"
          description="Release in_use profiles whose jobs are all in terminal state. Safe to run anytime."
          onAction={async () => {
            const r = await resetStuckProfiles();
            return {
              ok: true,
              message:
                r.released > 0
                  ? `Released ${r.released} stuck profile(s).`
                  : 'No stuck profiles found.',
            };
          }}
        />
        <ActionButton
          label="Deep Health Check"
          description="Run a full health check against Postgres and Redis."
          onAction={async () => {
            const r = await fetchDeepHealth();
            const failed = Object.entries(r.checks)
              .filter(([, c]) => !c.ok)
              .map(([name]) => name);
            return {
              ok: r.ok,
              message: r.ok
                ? 'All checks passed.'
                : `Failed: ${failed.join(', ')}`,
            };
          }}
        />
      </Card>
    </div>
  );
}
