import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Permission, Role } from '../../types';
import { useAuth } from '../../context/AuthContext';

// Preferred column order for the matrix.
const ACTION_ORDER = ['read', 'create', 'update', 'delete', 'sync'];

function resourceLabel(resource: string) {
  return resource
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function RoleFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const { has } = useAuth();
  const canManage = isNew ? has('roles:create') : has('roles:update');
  const viewOnly = !canManage;

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdminRole, setIsAdminRole] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const requests: [Promise<{ data: Permission[] }>, Promise<{ data: Role }>?] = [
      api.get<Permission[]>('/permissions'),
    ];
    if (!isNew) requests.push(api.get<Role>(`/roles/${id}`));

    Promise.all(requests as Promise<{ data: Permission[] | Role }>[])
      .then((res) => {
        if (!active) return;
        setPermissions(res[0].data as Permission[]);
        if (!isNew && res[1]) {
          const role = res[1].data as Role;
          setName(role.name);
          setDescription(role.description ?? '');
          setSelected(new Set(role.permissionIds ?? []));
          setIsAdminRole(role.name === 'admin');
        }
      })
      .catch(() => active && setLoadError('Failed to load.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, isNew]);

  // Group permissions by resource and collect the set of actions used.
  const { grouped, actions } = useMemo(() => {
    const grouped = new Map<string, Map<string, Permission>>();
    const actionSet = new Set<string>();
    for (const p of permissions) {
      if (!grouped.has(p.resource)) grouped.set(p.resource, new Map());
      grouped.get(p.resource)!.set(p.action, p);
      actionSet.add(p.action);
    }
    const actions = ACTION_ORDER.filter((a) => actionSet.has(a)).concat(
      [...actionSet].filter((a) => !ACTION_ORDER.includes(a)),
    );
    return { grouped, actions };
  }, [permissions]);

  function toggle(id: string) {
    if (viewOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleResource(resource: string, on: boolean) {
    if (viewOnly) return;
    const ids = [...(grouped.get(resource)?.values() ?? [])].map((p) => p.id);
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((pid) => (on ? next.add(pid) : next.delete(pid)));
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      name,
      description: description || undefined,
      permissionIds: [...selected],
    };
    try {
      if (isNew) await api.post('/roles', payload);
      else await api.put(`/roles/${id}`, payload);
      navigate('/admin/roles');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
        <Link to="/admin/roles" className="btn-secondary">
          ← Back to roles
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          to="/admin/roles"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {isNew ? 'Add Role' : viewOnly ? 'Role Detail' : 'Edit Role'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Assign menu access and CRUD/sync permissions.
          </p>
        </div>
      </div>

      {isAdminRole && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-medium">Superuser role.</span> The{' '}
          <span className="font-medium">admin</span> role always has full access
          regardless of the checkboxes below.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Details */}
        <div className="card p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Role name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. supervisor"
                disabled={viewOnly || isAdminRole}
                required
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={viewOnly}
              />
            </div>
          </div>
        </div>

        {/* Permission matrix */}
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Permissions
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Module</th>
                  {actions.map((a) => (
                    <th key={a} className="px-4 py-3 text-center">
                      {a}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center">All</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...grouped.entries()].map(([resource, byAction]) => {
                  const ids = [...byAction.values()].map((p) => p.id);
                  const allOn = ids.every((pid) => selected.has(pid));
                  return (
                    <tr key={resource} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-700">
                        {resourceLabel(resource)}
                      </td>
                      {actions.map((a) => {
                        const perm = byAction.get(a);
                        return (
                          <td key={a} className="px-4 py-3 text-center">
                            {perm ? (
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                                checked={isAdminRole || selected.has(perm.id)}
                                disabled={viewOnly || isAdminRole}
                                onChange={() => toggle(perm.id)}
                              />
                            ) : (
                              <span className="text-slate-200">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                          checked={isAdminRole || allOn}
                          disabled={viewOnly || isAdminRole}
                          onChange={(e) =>
                            toggleResource(resource, e.target.checked)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Link to="/admin/roles" className="btn-secondary">
            {viewOnly ? 'Back' : 'Cancel'}
          </Link>
          {canManage && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save role'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
