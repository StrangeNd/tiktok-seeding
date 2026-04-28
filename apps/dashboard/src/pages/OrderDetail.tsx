import { useParams, Link } from 'react-router-dom';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { fetchOrder } from '../lib/api';
import { useFetch } from '../lib/hooks';

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);

  const { data, loading, error, refetch } = useFetch(
    () => fetchOrder(orderId),
    [orderId],
  );

  if (!Number.isFinite(orderId)) {
    return <p className="text-red-600">Invalid order ID</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/orders"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Orders
        </Link>
        <h1 className="text-lg font-bold text-gray-900">Order #{id}</h1>
        <button
          type="button"
          onClick={refetch}
          className="text-sm text-gray-500 hover:text-gray-700 ml-auto"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !data ? null : (
        <>
          <Card title="Order Info">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Status</p>
                <StatusBadge status={data.order.status} />
              </div>
              <div>
                <p className="text-gray-500">Type</p>
                <p className="font-medium">{data.order.type}</p>
              </div>
              <div>
                <p className="text-gray-500">Count</p>
                <p className="font-medium">{data.order.count}</p>
              </div>
              <div>
                <p className="text-gray-500">Progress</p>
                <p className="font-medium">
                  {data.order.completedJobs} / {data.order.count}
                  {data.order.failedJobs > 0 && (
                    <span className="text-red-500 ml-1">
                      ({data.order.failedJobs} failed)
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Target URL</p>
                <a
                  href={data.order.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all"
                >
                  {data.order.targetUrl}
                </a>
              </div>
              <div>
                <p className="text-gray-500">Watch</p>
                <p className="font-medium">{data.order.watchSeconds}s</p>
              </div>
              <div>
                <p className="text-gray-500">Spread</p>
                <p className="font-medium">{data.order.spreadSeconds}s</p>
              </div>
              <div>
                <p className="text-gray-500">Created</p>
                <p className="font-medium">
                  {new Date(data.order.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          </Card>

          <Card title={`${data.jobs.length} Jobs`}>
            {data.jobs.length === 0 ? (
              <p className="text-sm text-gray-400">No jobs.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 font-medium">ID</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Profile</th>
                      <th className="pb-2 font-medium">Attempt</th>
                      <th className="pb-2 font-medium">Duration</th>
                      <th className="pb-2 font-medium">Error</th>
                      <th className="pb-2 font-medium">Started</th>
                      <th className="pb-2 font-medium">Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <tr key={j.id} className="border-b border-gray-100">
                        <td className="py-2">{j.id}</td>
                        <td className="py-2">
                          <StatusBadge status={j.status} />
                        </td>
                        <td className="py-2 text-gray-600 font-mono text-xs max-w-[120px] truncate">
                          {j.profileId}
                        </td>
                        <td className="py-2">{j.attempt}</td>
                        <td className="py-2 text-gray-500">
                          {j.durationMs != null
                            ? `${(j.durationMs / 1000).toFixed(1)}s`
                            : '—'}
                        </td>
                        <td className="py-2 text-red-500 text-xs max-w-[200px] truncate">
                          {j.errorCode
                            ? `${j.errorCode}: ${j.errorMessage ?? ''}`
                            : '—'}
                        </td>
                        <td className="py-2 text-gray-500 text-xs">
                          {j.startedAt
                            ? new Date(j.startedAt).toLocaleString()
                            : '—'}
                        </td>
                        <td className="py-2 text-gray-500 text-xs">
                          {j.finishedAt
                            ? new Date(j.finishedAt).toLocaleString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
