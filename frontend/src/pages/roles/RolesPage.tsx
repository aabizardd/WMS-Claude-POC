import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Role } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

export default function RolesPage() {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('roles:create');
  const canUpdate = has('roles:update');
  const canDelete = has('roles:delete');

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await api.get<Role[]>('/roles');
    setRoles(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function handleDelete(role: Role) {
    const ok = await confirm({
      title: 'Delete role?',
      description: `"${role.name}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/roles/${role.id}`);
      toast.success('Role deleted');
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
          <h1 className="text-2xl font-semibold text-slate-800">Roles</h1>
          <p className="mt-1 text-sm text-slate-500">
            Roles and their assigned permissions (menu access + CRUD + sync).
          </p>
        </div>
        {canCreate && (
          <Link to="/admin/roles/new" className="btn-primary">
            + Add Role
          </Link>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Permissions</th>
                <th className="px-6 py-3">Users</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : roles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400">
                    No roles yet.
                  </td>
                </tr>
              ) : (
                roles.map((role) => (
                  <tr key={role.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium capitalize text-brand-700">
                        {role.name}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {role.description || (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {role.name === 'admin' ? (
                        <span className="text-xs font-medium text-emerald-600">
                          All (superuser)
                        </span>
                      ) : (
                        `${role.permissions?.length ?? 0} permission(s)`
                      )}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {role.userCount ?? 0}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/admin/roles/${role.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          {canUpdate ? 'Edit' : 'View'}
                        </Link>
                        {canDelete && role.name !== 'admin' && (
                          <button
                            onClick={() => handleDelete(role)}
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
