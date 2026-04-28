import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import {
  fetchDeepHealth,
  fetchOrders,
  fetchProfileSummary,
  fetchWorkers,
} from '../lib/api';
import { useFetch } from '../lib/hooks';

export function OverviewPage() {
  const health = useFetch(fetchDeepHealth);
  const profiles = useFetch(fetchProfileSummary);
  const workers = useFetch(fetchWorkers);
  const orders = useFetch(fetchOrders);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-gray-900">Overview</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">System</p>
          {health.loading ? (
            <p className="text-sm text-gray-400 mt-1">Loading...</p>
          ) : health.error ? (
            <p className="text-sm text-red-600 mt-1">Error</p>
          ) : (
            <p className={`text-2xl font-bold mt-1 ${health.data?.ok ? 'text-green-600' : 'text-red-600'}`}>
              {health.data?.ok ? 'Healthy' : 'Unhealthy'}
            </p>
          )}
        </div>

        {/* Profile count */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Profiles</p>
          {profiles.loading ? (
            <p className="text-sm text-gray-400 mt-1">Loading...</p>
          ) : (
            <p className="text-2xl font-bold mt-1 text-gray-900">
              {profiles.data?.total ?? 0}
            </p>
          )}
        </div>

        {/* Workers */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Workers</p>
          {workers.loading ? (
            <p className="text-sm text-gray-400 mt-1">Loading...</p>
          ) : (
            <p className="text-2xl font-bold mt-1 text-gray-900">
              {workers.data?.workers.length ?? 0}
            </p>
          )}
        </div>

        {/* Orders */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Orders</p>
          {orders.loading ? (
            <p className="text-sm text-gray-400 mt-1">Loading...</p>
          ) : (
            <p className="text-2xl font-bold mt-1 text-gray-900">
              {orders.data?.orders.length ?? 0}
            </p>
          )}
        </div>
      </div>

      {/* Deep health detail */}
      <Card title="Service Health">
        {health.loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : health.error ? (
          <p className="text-sm text-red-600">{health.error}</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(health.data?.checks ?? {}).map(([name, check]) => (
              <div key={name} className="flex items-center justify-between">
                <span className="text-sm text-gray-700 capitalize">{name}</span>
                <StatusBadge status={check.ok ? 'available' : 'broken'} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Profile summary */}
      <Card title="Profile Status Breakdown">
        {profiles.loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : profiles.error ? (
          <p className="text-sm text-red-600">{profiles.error}</p>
        ) : (
          <div className="flex gap-4 flex-wrap">
            {Object.entries(profiles.data?.summary ?? {}).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2">
                <StatusBadge status={status} />
                <span className="text-sm font-medium text-gray-700">{count}</span>
              </div>
            ))}
            {Object.keys(profiles.data?.summary ?? {}).length === 0 && (
              <p className="text-sm text-gray-400">No profiles synced yet.</p>
            )}
          </div>
        )}
      </Card>

      {/* Recent orders */}
      <Card title="Recent Orders">
        {orders.loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : orders.error ? (
          <p className="text-sm text-red-600">{orders.error}</p>
        ) : orders.data?.orders.length === 0 ? (
          <p className="text-sm text-gray-400">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">ID</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Count</th>
                  <th className="pb-2 font-medium">Progress</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.data?.orders.slice(0, 10).map((o) => (
                  <tr key={o.id} className="border-b border-gray-100">
                    <td className="py-2">{o.id}</td>
                    <td className="py-2"><StatusBadge status={o.status} /></td>
                    <td className="py-2">{o.type}</td>
                    <td className="py-2">{o.count}</td>
                    <td className="py-2">
                      {o.completedJobs}/{o.count}
                      {o.failedJobs > 0 && (
                        <span className="text-red-500 ml-1">({o.failedJobs} failed)</span>
                      )}
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Workers */}
      <Card title="Workers">
        {workers.loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : workers.error ? (
          <p className="text-sm text-red-600">{workers.error}</p>
        ) : workers.data?.workers.length === 0 ? (
          <p className="text-sm text-gray-400">No workers registered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Load</th>
                  <th className="pb-2 font-medium">Capacity</th>
                  <th className="pb-2 font-medium">Version</th>
                  <th className="pb-2 font-medium">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {workers.data?.workers.map((w) => (
                  <tr key={w.name} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{w.name}</td>
                    <td className="py-2">{w.currentLoad}</td>
                    <td className="py-2">{w.capacity}</td>
                    <td className="py-2 text-gray-500">{w.version ?? '—'}</td>
                    <td className="py-2 text-gray-500">
                      {new Date(w.lastSeenAt).toLocaleString()}
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
