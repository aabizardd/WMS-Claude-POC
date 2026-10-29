import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { User } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { Cell, StatusPill, fmtDateTime, icons } from '../../components/master/MasterKit';

/** WMS dev: the first warehouse, and "+N" for the rest (all of them on hover). */
function WarehousesCell({ warehouses }: { warehouses: User['warehouses'] }) {
  if (!warehouses?.length) return <Cell>{null}</Cell>;
  const [first, ...rest] = warehouses;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={warehouses.map((w) => w.name).join('\n')}>
      <span>{first.name}</span>
      {rest.length > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600">+{rest.length}</span>
      )}
    </span>
  );
}

// WMS dev's User Master columns, as far as the POC's users carry them.
const COLUMNS: MasterColumn<User>[] = [
  { label: 'Status', sortKey: 'is_active', width: 120, render: (u) => <StatusPill active={u.isActive} /> },
  { label: 'User ID', render: (u) => <Cell>{u.id}</Cell> },
  { label: 'Username', sortKey: 'username', render: (u) => <Cell>{u.username}</Cell> },
  { label: 'Full Name', sortKey: 'name', render: (u) => <Cell>{u.name}</Cell> },
  { label: 'Email', sortKey: 'email', render: (u) => <Cell>{u.email}</Cell> },
  { label: 'Role', sortKey: 'role', render: (u) => <Cell>{u.role?.name}</Cell> },
  { label: 'Warehouse', render: (u) => <WarehousesCell warehouses={u.warehouses} /> },
  { label: 'Employee ID', sortKey: 'employee_id', render: (u) => <Cell>{u.employeeId}</Cell> },
  { label: 'Department', render: (u) => <Cell>{u.department?.name}</Cell> },
  { label: 'Subsidiary', render: (u) => <Cell>{u.subsidiary?.name}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (u) => <Cell>{fmtDateTime(u.createdAt)}</Cell> },
  { label: 'Last Modified At', render: (u) => <Cell>{fmtDateTime(u.updatedAt)}</Cell> },
];

export default function UsersPage() {
  const { has } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('users:create');
  const canUpdate = has('users:update');
  const canDelete = has('users:delete');
  const [reloadKey, setReloadKey] = useState(0);

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
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.message ?? 'Delete failed');
      else toast.error('Delete failed');
    }
  }

  return (
    <MasterList<User>
      endpoint="/users"
      columns={COLUMNS}
      reloadKey={reloadKey}
      addLabel={canCreate ? 'Add User' : undefined}
      onAdd={() => navigate('/admin/users/new')}
      rowActions={(u) => [
        {
          label: canUpdate ? 'Edit' : 'View',
          icon: canUpdate ? icons.pencil : icons.eye,
          onClick: () => navigate(`/admin/users/${u.id}`),
        },
        ...(canDelete ? [{ label: 'Delete', icon: icons.trash, onClick: () => handleDelete(u) }] : []),
      ]}
    />
  );
}
