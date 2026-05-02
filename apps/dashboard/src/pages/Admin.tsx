import { useState } from 'react';
import { Card, ErrorState, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toast';

interface DeepHealth {
  ok: boolean;
  checks: {
    postgres: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string };
  };
}

export function Admin() {
  const hc = useFetch<DeepHealth>('/health/deep', { intervalMs: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, path: string) {
    setBusy(label);
    try {
      const r = await api<unknown>(path, { method: 'POST' });
      toast.success(`${label} done`, JSON.stringify(r));
    } catch (e) {
      toast.error(`${label} failed`, (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Admin & Recovery</h1>
        <p className="text-sm text-text-muted">
          Operational health and safe recovery actions. Destructive actions are intentionally not
          exposed here.
        </p>
      </div>

      <Card title="Deep health check">
        {hc.loading && !hc.data ? (
          <Spinner />
        ) : hc.error ? (
          <ErrorState message={hc.error} onRetry={hc.reload} />
        ) : hc.data ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">Overall:</span>
              <StatusBadge status={hc.data.ok ? 'healthy' : 'degraded'} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <CheckRow
                name="Postgres"
                ok={hc.data.checks.postgres.ok}
                error={hc.data.checks.postgres.error}
              />
              <CheckRow
                name="Redis"
                ok={hc.data.checks.redis.ok}
                error={hc.data.checks.redis.error}
              />
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="Recovery actions">
        <div className="space-y-3">
          <ActionRow
            title="Reset stuck profiles"
            description="Releases profiles stuck in_use whose jobs are all in terminal state. Idempotent and safe to run while workers are active."
            buttonLabel="Run"
            onClick={() => run('Reset stuck profiles', '/admin/reset-stuck-profiles')}
            busy={busy === 'Reset stuck profiles'}
          />
          <ActionRow
            title="Sync profiles from GPM"
            description="Pulls the latest profile pool from GPM Login and upserts into the database. Safe to run any time."
            buttonLabel="Run"
            onClick={() => run('Sync profiles', '/admin/sync-profiles')}
            busy={busy === 'Sync profiles'}
          />
        </div>
      </Card>

      <Card title="Operator runbook">
        <div className="text-sm text-text-muted space-y-1">
          <div>
            For lifecycle actions (start/stop/status), use the Windows operator scripts. See{' '}
            <span className="kbd">docs/RUNBOOK_WINDOWS.md</span> at the repo root.
          </div>
          <ul className="list-disc list-inside text-xs text-text-subtle space-y-0.5 mt-2">
            <li>
              <span className="kbd">pnpm start:all</span> — start master + worker
            </li>
            <li>
              <span className="kbd">pnpm status</span> — health, heartbeat, pools
            </li>
            <li>
              <span className="kbd">pnpm stop:all</span> — graceful shutdown
            </li>
            <li>
              <span className="kbd">pnpm reset:profiles</span> — same as the button above
            </li>
            <li>
              <span className="kbd">pnpm dashboard</span> — start this dashboard
            </li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

function CheckRow({ name, ok, error }: { name: string; ok: boolean; error?: string }) {
  return (
    <div className="flex items-center justify-between border border-border rounded-md px-3 py-2 bg-bg-subtle">
      <div className="text-sm">{name}</div>
      <div className="flex items-center gap-2">
        {ok ? <span className="badge-ok">ok</span> : <span className="badge-danger">fail</span>}
        {error && (
          <span className="text-xs text-text-muted truncate max-w-[200px]" title={error}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function ActionRow({
  title,
  description,
  buttonLabel,
  onClick,
  busy,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border border-border rounded-md p-3 bg-bg-subtle">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-text-muted mt-0.5 max-w-2xl">{description}</div>
      </div>
      <button type="button" className="btn-primary" onClick={onClick} disabled={busy}>
        {busy && <Spinner />} {buttonLabel}
      </button>
    </div>
  );
}
