import { Card, ErrorState, Spinner, StatusBadge, fmtRelTime } from '../components/ui';
import { type CurrentUser, api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';

interface UserRow extends CurrentUser {
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export function Users() {
  const me = useAuth((s) => s.user);
  const list = useFetch<{ items: UserRow[] }>('/admin/users', { intervalMs: 30_000 });
  if (me?.role !== 'admin') return <ErrorState message="Admin access required" />;

  async function patch(id: number, body: Partial<Pick<UserRow, 'role' | 'status'>>) {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      toast.success('User updated');
      list.reload();
    } catch (e) {
      toast.error('Update failed', (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-text-muted">Manage local dashboard users and roles.</p>
      </div>
      <Card pad={false}>
        {list.loading && !list.data ? (
          <div className="p-10">
            <Spinner /> loading…
          </div>
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((u) => (
                <tr key={u.id}>
                  <td className="font-mono text-text-subtle">{u.id}</td>
                  <td>
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-text-muted">{u.username}</div>
                  </td>
                  <td>
                    <select
                      className="input w-28 text-xs"
                      value={u.role}
                      onChange={(e) => patch(u.id, { role: e.target.value as 'admin' | 'user' })}
                    >
                      <option value="admin">admin</option>
                      <option value="user">user</option>
                    </select>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={u.status} />
                      <select
                        className="input w-28 text-xs"
                        value={u.status}
                        onChange={(e) =>
                          patch(u.id, {
                            status: e.target.value as 'active' | 'pending' | 'disabled',
                          })
                        }
                      >
                        <option value="active">active</option>
                        <option value="pending">pending</option>
                        <option value="disabled">disabled</option>
                      </select>
                    </div>
                  </td>
                  <td className="text-text-muted">{fmtRelTime(u.lastLoginAt)}</td>
                  <td className="text-text-muted">{fmtRelTime(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
