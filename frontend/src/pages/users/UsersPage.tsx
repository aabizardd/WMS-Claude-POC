import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { User } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useSort, sortRows } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

export default function UsersPage() {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('users:create');
  const canUpdate = has('users:update');
  const canDelete = has('users:delete');

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const { sort, toggle } = useSort();

  // Client-side sorting (this list is not paginated).
  const rows = sortRows(users, sort, (u, col) => {
    switch (col) {
      case 'name': return u.name;
      case 'username': return u.username;
      case 'email': return u.email;
      case 'role': return u.role.name;
      case 'warehouse': return u.warehouse?.name ?? null;
      case 'status': return u.isActive ? 1 : 0;
      default: return null;
    }
  });

  async function load() {
    setLoading(true);
    const r = await api.get<User[]>('/users');
    setUsers(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function handleDelete(u: User) {
    const ok = await confirm({
      title: 'Delete user?',
      description: `"${u.name}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success('User deleted');
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message ?? 'Delete failed');
      } else toast.error('Delete failed');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage application users, their role, and warehouse.
          </p>
        </div>
        {canCreate && (
          <Link to="/admin/users/new" className="btn-primary">
            + Add User
          </Link>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="Name" col="name" sort={sort} onSort={toggle} />
                <SortableTh label="Username" col="username" sort={sort} onSort={toggle} />
                <SortableTh label="Email" col="email" sort={sort} onSort={toggle} />
                <SortableTh label="Role" col="role" sort={sort} onSort={toggle} />
                <SortableTh label="Warehouse" col="warehouse" sort={sort} onSort={toggle} />
                <SortableTh label="Status" col="status" sort={sort} onSort={toggle} />
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    No users yet.
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {u.name}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{u.username}</td>
                    <td className="px-6 py-3 text-slate-600">{u.email}</td>
                    <td className="px-6 py-3">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium capitalize text-brand-700">
                        {u.role.name}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {u.warehouse?.name ?? (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                          <span className="h-2 w-2 rounded-full bg-slate-300" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/admin/users/${u.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          {canUpdate ? 'Edit' : 'View'}
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(u)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
