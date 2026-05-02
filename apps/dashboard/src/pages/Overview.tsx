import { Card, EmptyState, ErrorState, Spinner, StatTile, fmtRelTime } from '../components/ui';
import { useFetch } from '../lib/useFetch';

interface SystemSummary {
  profiles: { byStatus: Record<string, number> };
  orders: { byStatus: Record<string, number> };
  jobs: { byStatus: Record<string, number> };
  workers: {
    name: string;
    capacity: number;
    currentLoad: number;
    version: string | null;
    lastSeenAt: string;
  }[];
}

interface AccountsSummary {
  total: number;
  byStatus: Record<string, number>;
  withCookie: number;
  withMailRefreshToken: number;
}
interface ProxiesSummary {
  total: number;
  byStatus: Record<string, number>;
  withAuth: number;
  avgLatencyMs: number | null;
}
interface DeepHealth {
  ok: boolean;
  checks: { postgres: { ok: boolean }; redis: { ok: boolean } };
}

export function Overview() {
  const sys = useFetch<SystemSummary>('/system/summary', { intervalMs: 10_000 });
  const accs = useFetch<AccountsSummary>('/accounts/summary', { intervalMs: 30_000 });
  const prx = useFetch<ProxiesSummary>('/proxies/summary', { intervalMs: 30_000 });
  const hc = useFetch<DeepHealth>('/health/deep', { intervalMs: 15_000 });

  if (sys.loading && !sys.data) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <Spinner /> Loading overview…
      </div>
    );
  }
  if (sys.error) return <ErrorState message={sys.error} onRetry={sys.reload} />;
  if (!sys.data) return <EmptyState title="No data yet" />;

  const profileTotal = Object.values(sys.data.profiles.byStatus).reduce((a, b) => a + b, 0);
  const profileAvail = sys.data.profiles.byStatus.available ?? 0;
  const profileInUse = sys.data.profiles.byStatus.in_use ?? 0;
  const ordersRunning = sys.data.orders.byStatus.running ?? 0;
  const ordersDone = sys.data.orders.byStatus.done ?? 0;
  const jobsRunning = sys.data.jobs.byStatus.running ?? 0;
  const jobsFailed = sys.data.jobs.byStatus.failed ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-text-muted">
            Live system snapshot. Auto-refreshing every 10–30s.
          </p>
        </div>
      </div>

      {/* Top tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Profiles available"
          value={profileAvail}
          hint={`${profileTotal} total · ${profileInUse} in use`}
          tone={profileAvail > 0 ? 'ok' : 'warn'}
        />
        <StatTile
          label="Orders running"
          value={ordersRunning}
          hint={`${ordersDone} completed`}
          tone={ordersRunning > 0 ? 'info' : 'default'}
        />
        <StatTile
          label="Jobs running"
          value={jobsRunning}
          hint={jobsFailed > 0 ? `${jobsFailed} failed` : 'no failures'}
          tone={jobsFailed > 0 ? 'danger' : jobsRunning > 0 ? 'info' : 'default'}
        />
        <StatTile
          label="Health"
          value={hc.data?.ok ? 'OK' : <span className="text-danger">DOWN</span>}
          hint={
            hc.data
              ? `pg=${hc.data.checks.postgres.ok ? 'OK' : 'fail'} redis=${
                  hc.data.checks.redis.ok ? 'OK' : 'fail'
                }`
              : '—'
          }
          tone={hc.data?.ok ? 'ok' : 'danger'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Accounts">
          {accs.loading && !accs.data ? (
            <Spinner />
          ) : accs.error ? (
            <div className="text-danger text-sm">{accs.error}</div>
          ) : accs.data ? (
            <div className="space-y-2 text-sm">
              <Row label="Total" value={accs.data.total} />
              <Row label="With cookie" value={accs.data.withCookie} />
              <Row label="With mail refresh token" value={accs.data.withMailRefreshToken} />
              {Object.entries(accs.data.byStatus).map(([k, v]) => (
                <Row key={k} label={`Status: ${k}`} value={v} />
              ))}
            </div>
          ) : null}
        </Card>

        <Card title="Proxies">
          {prx.loading && !prx.data ? (
            <Spinner />
          ) : prx.error ? (
            <div className="text-danger text-sm">{prx.error}</div>
          ) : prx.data ? (
            <div className="space-y-2 text-sm">
              <Row label="Total" value={prx.data.total} />
              <Row label="With auth" value={prx.data.withAuth} />
              <Row
                label="Avg latency (ok)"
                value={prx.data.avgLatencyMs ? `${prx.data.avgLatencyMs}ms` : '—'}
              />
              {Object.entries(prx.data.byStatus).map(([k, v]) => (
                <Row key={k} label={`Status: ${k}`} value={v} />
              ))}
            </div>
          ) : null}
        </Card>

        <Card title="Workers">
          {sys.data.workers.length === 0 ? (
            <EmptyState
              title="No worker has reported yet"
              hint="Run pnpm start:all to launch a worker."
            />
          ) : (
            <div className="space-y-2 text-sm">
              {sys.data.workers.map((w) => (
                <div
                  key={w.name}
                  className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0"
                >
                  <div>
                    <div className="font-medium">{w.name}</div>
                    <div className="text-xs text-text-subtle">v{w.version ?? '?'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      {w.currentLoad}/{w.capacity}
                    </div>
                    <div className="text-xs text-text-subtle">{fmtRelTime(w.lastSeenAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
