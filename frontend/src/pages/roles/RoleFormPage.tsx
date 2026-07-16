import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import FormField, { requiredErrors } from '../../components/form/FormField';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Permission, Role } from '../../types';
import { useAuth } from '../../context/AuthContext';
import Collapsible from '../../components/Collapsible';

function actionLabel(action: string) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

// Permission tree mirrors the application navigation. Leaves carry a `resource`
// (its permissions/actions render as checkboxes); groups have `children`;
// `comingSoon` nodes are placeholders without permissions yet.
type TreeNode =
  | { label: string; children: TreeNode[] }
  | { label: string; resource: string }
  | { label: string; comingSoon: true };

const PERMISSION_TREE: TreeNode[] = [
  {
    label: 'Master Data',
    children: [
      {
        label: 'Material',
        children: [
          { label: 'Material Info', resource: 'materials' },
          { label: 'Categories', resource: 'material-categories' },
          { label: 'Types', resource: 'material-types' },
          { label: 'UOM', resource: 'uoms' },
        ],
      },
      {
        label: 'Warehouse Management',
        children: [
          { label: 'Warehouse', resource: 'warehouses' },
          { label: 'Area', resource: 'area-types' },
          { label: 'Aisles', resource: 'aisles' },
          { label: 'Shelves', resource: 'shelves' },
          { label: 'Bin', resource: 'bins' },
        ],
      },
      { label: 'Vendors', resource: 'vendors' },
      { label: 'Customers', resource: 'customers' },
      { label: 'Departments', resource: 'departments' },
      { label: 'Classes', resource: 'classes' },
      { label: 'Subsidiaries', resource: 'subsidiaries' },
      {
        label: 'User Management',
        children: [
          { label: 'Users', resource: 'users' },
          { label: 'Roles', resource: 'roles' },
        ],
      },
    ],
  },
  {
    label: 'Inbound',
    children: [
      {
        label: 'Inbound from PIB',
        children: [
          { label: 'MRN', resource: 'mrn' },
          { label: 'Goods Receive', resource: 'goods-receive' },
          { label: 'Putaway', resource: 'putaway' },
        ],
      },
      {
        label: 'Inbound from Local Vendor',
        children: [{ label: 'PO', resource: 'purchase-orders' }],
      },
      { label: 'Inbound from Customer Return', comingSoon: true },
      { label: 'Inbound from Stock Transfer', comingSoon: true },
    ],
  },
  {
    // Flat on purpose: only the source lists are per-document (SO vs TO).
    // Picking/Packing/Delivery are a single shared resource each, serving both
    // sources — nesting them under a source would imply a per-source permission
    // that does not exist and would render the same checkbox twice.
    label: 'Outbound',
    children: [
      { label: 'List SO (Sales Order)', resource: 'sales-orders' },
      { label: 'List TO (Transfer Order)', resource: 'transfer-orders' },
      { label: 'Picking', resource: 'picking' },
      { label: 'Packing', resource: 'packing' },
      { label: 'Delivery', resource: 'delivery' },
    ],
  },
  {
    label: 'Inventory',
    children: [
      { label: 'Inventory Management', resource: 'inventory' },
      { label: 'Inventory Adjustment', resource: 'inventory-adjustments' },
    ],
  },
  { label: 'Discrepancy', resource: 'discrepancy' },
  { label: 'Complaint', resource: 'complaints' },
  { label: 'Report', comingSoon: true },
  {
    label: 'System',
    children: [{ label: 'Sync Logs', resource: 'sync-logs' }],
  },
];

function treeResources(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) =>
    'children' in n ? treeResources(n.children) : 'resource' in n ? [n.resource] : [],
  );
}

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
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  // Effective tree: the static navigation tree + any permission resources not
  // mapped anywhere (appended under "Other" so nothing is unmanageable).
  const treeNodes = useMemo<TreeNode[]>(() => {
    const covered = new Set(treeResources(PERMISSION_TREE));
    const extras = [...grouped.keys()].filter((r) => !covered.has(r));
    if (extras.length === 0) return PERMISSION_TREE;
    return [
      ...PERMISSION_TREE,
      {
        label: 'Other',
        children: extras.map((r) => ({ label: resourceLabel(r), resource: r })),
      },
    ];
  }, [grouped]);

  const searching = search.trim().length > 0;
  // Searching forces matched nodes open so results are visible.
  const isOpen = (key: string) => searching || !collapsed.has(key);

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggle(id: string) {
    if (viewOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[], on: boolean) {
    if (viewOnly || ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((pid) => (on ? next.add(pid) : next.delete(pid)));
      return next;
    });
  }

  // ---- tree helpers (closures over grouped / actions) ----
  const permsOf = (resource: string): Permission[] => {
    const byAction = grouped.get(resource);
    return actions
      .map((a) => byAction?.get(a))
      .filter((p): p is Permission => !!p);
  };
  const collectIds = (node: TreeNode): string[] =>
    'children' in node
      ? node.children.flatMap(collectIds)
      : 'resource' in node
        ? permsOf(node.resource).map((p) => p.id)
        : [];
  const nodeMatches = (node: TreeNode, q: string): boolean => {
    if (node.label.toLowerCase().includes(q)) return true;
    if ('children' in node) return node.children.some((c) => nodeMatches(c, q));
    if ('resource' in node)
      return permsOf(node.resource).some(
        (p) =>
          p.action.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
      );
    return false;
  };

  function renderNode(node: TreeNode, parentKey: string): ReactNode {
    const key = `${parentKey}/${node.label}`;
    const q = search.trim().toLowerCase();
    if (q && !nodeMatches(node, q)) return null;

    // Group node -> nested collapsible.
    if ('children' in node) {
      const ids = collectIds(node);
      const selCount = ids.filter((i) => selected.has(i)).length;
      const allOn = ids.length > 0 && selCount === ids.length;
      return (
        <Collapsible
          key={key}
          open={isOpen(key)}
          onToggle={() => toggleCollapse(key)}
          title={node.label}
          subtitle={ids.length ? `${isAdminRole ? ids.length : selCount}/${ids.length}` : undefined}
          right={
            ids.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                  checked={isAdminRole || allOn}
                  disabled={viewOnly || isAdminRole}
                  onChange={(e) => toggleMany(ids, e.target.checked)}
                />
                All
              </label>
            )
          }
        >
          <div className="space-y-1.5">
            {node.children.map((c) => renderNode(c, key))}
          </div>
        </Collapsible>
      );
    }

    // Coming-soon placeholder (no permissions yet).
    if ('comingSoon' in node) {
      return (
        <div key={key} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400">
          {node.label}
          <span className="badge bg-amber-100 text-amber-700">Coming soon</span>
        </div>
      );
    }

    // Leaf node -> its permission actions as checkboxes.
    const all = permsOf(node.resource);
    const labelMatch = !q || node.label.toLowerCase().includes(q);
    const perms = labelMatch
      ? all
      : all.filter(
          (p) =>
            p.action.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
        );
    const ids = all.map((p) => p.id);
    const selCount = ids.filter((i) => selected.has(i)).length;
    const allOn = ids.length > 0 && selCount === ids.length;
    return (
      <div
        key={key}
        className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg px-3 py-2 hover:bg-slate-50"
      >
        <label className="flex w-44 items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
            checked={isAdminRole || allOn}
            disabled={viewOnly || isAdminRole || ids.length === 0}
            onChange={(e) => toggleMany(ids, e.target.checked)}
          />
          {node.label}
          {ids.length > 0 && (
            <span className="text-xs font-normal text-slate-400">
              {isAdminRole ? ids.length : selCount}/{ids.length}
            </span>
          )}
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {perms.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-1.5 text-sm text-slate-600"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                checked={isAdminRole || selected.has(p.id)}
                disabled={viewOnly || isAdminRole}
                onChange={() => toggle(p.id)}
              />
              {actionLabel(p.action)}
            </label>
          ))}
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs = requiredErrors([['name', name, 'Role name is required']]);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
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
      <div className="space-y-4">
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
    <div className="space-y-6">
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
            <FormField label="Role name" required error={fieldErrors.name}>
              <input
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((p) => ({ ...p, name: '' }));
                }}
                placeholder="e.g. supervisor"
                disabled={viewOnly || isAdminRole}
              />
            </FormField>
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

        {/* Permissions — grouped by module, collapsible + searchable */}
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Permissions
            </h3>
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                className="input w-64 pl-9"
                placeholder="Search permission or module…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {(() => {
            const rendered = treeNodes
              .map((n) => renderNode(n, 'root'))
              .filter(Boolean);
            return rendered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                No permissions match “{search}”.
              </div>
            ) : (
              <div className="space-y-2">{rendered}</div>
            );
          })()}
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
