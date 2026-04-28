const colors: Record<string, string> = {
  available: 'bg-green-100 text-green-800',
  in_use: 'bg-blue-100 text-blue-800',
  broken: 'bg-red-100 text-red-800',
  quarantined: 'bg-yellow-100 text-yellow-800',
  queued: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
  pending: 'bg-gray-100 text-gray-800',
  succeeded: 'bg-green-100 text-green-800',
  retrying: 'bg-yellow-100 text-yellow-800',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colors[status] ?? 'bg-gray-100 text-gray-800';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
