import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { createOrder, fetchOrders } from '../lib/api';
import { useFetch } from '../lib/hooks';

export function OrdersPage() {
  const { data, loading, error, refetch } = useFetch(fetchOrders);
  const navigate = useNavigate();

  // Create order form state
  const [showForm, setShowForm] = useState(false);
  const [targetUrl, setTargetUrl] = useState('');
  const [count, setCount] = useState(2);
  const [watchSeconds, setWatchSeconds] = useState(30);
  const [spreadSeconds, setSpreadSeconds] = useState(3);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await createOrder({
        type: 'live_view',
        targetUrl,
        count,
        watchSeconds,
        spreadSeconds,
      });
      setShowForm(false);
      setTargetUrl('');
      refetch();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Orders</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800"
        >
          {showForm ? 'Cancel' : 'New Order'}
        </button>
      </div>

      {showForm && (
        <Card title="Create Order">
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Target URL
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://www.tiktok.com/@user/live"
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-normal focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </label>
            <div className="grid grid-cols-3 gap-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Count
                <input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  min={1}
                  max={500}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-normal focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Watch (seconds)
                <input
                  type="number"
                  value={watchSeconds}
                  onChange={(e) => setWatchSeconds(Number(e.target.value))}
                  min={10}
                  max={3600}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-normal focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Spread (seconds)
                <input
                  type="number"
                  value={spreadSeconds}
                  onChange={(e) => setSpreadSeconds(Number(e.target.value))}
                  min={0}
                  max={600}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-normal focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </label>
            </div>
            {createError && (
              <p className="text-sm text-red-600">{createError}</p>
            )}
            <button
              type="submit"
              disabled={creating || !targetUrl}
              className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Order'}
            </button>
          </form>
        </Card>
      )}

      <Card title={`${data?.orders.length ?? 0} orders`}>
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : data?.orders.length === 0 ? (
          <p className="text-sm text-gray-400">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">ID</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">URL</th>
                  <th className="pb-2 font-medium">Count</th>
                  <th className="pb-2 font-medium">Progress</th>
                  <th className="pb-2 font-medium">Watch</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data?.orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/orders/${o.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/orders/${o.id}`); }}
                  >
                    <td className="py-2">{o.id}</td>
                    <td className="py-2">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="py-2 text-gray-600 max-w-xs truncate">
                      {o.targetUrl}
                    </td>
                    <td className="py-2">{o.count}</td>
                    <td className="py-2">
                      <span className="text-green-600">{o.completedJobs}</span>
                      {o.failedJobs > 0 && (
                        <span className="text-red-500">/{o.failedJobs}f</span>
                      )}
                      <span className="text-gray-400">/{o.count}</span>
                    </td>
                    <td className="py-2 text-gray-500">{o.watchSeconds}s</td>
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
    </div>
  );
}
