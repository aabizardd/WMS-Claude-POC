import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Role } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { Cell, StatusPill, fmtDateTime, icons } from '../../components/master/MasterKit';

// WMS dev's Role Master columns; the permission and user counts are the POC's own.
const COLUMNS: MasterColumn<Role>[] = [
  { label: 'Status', sortKey: 'status', width: 120, render: (r) => <StatusPill active={r.isActive !== false} /> },
  { label: 'Role ID', render: (r) => <Cell>{r.id}</Cell> },
  { label: 'Role Name', sortKey: 'name', render: (r) => <Cell>{r.name}</Cell> },
  { label: 'Description', sortKey: 'description', render: (r) => <Cell>{r.description}</Cell> },
  {
    label: 'Permissions',
    sortKey: 'permissions',
    render: (r) => <Cell>{r.name === 'admin' ? 'All (superuser)' : `${r.permissions?.length ?? 0} permission(s)`}</Cell>,
  },
  { label: 'Users', sortKey: 'users', render: (r) => <Cell>{r.userCount ?? 0}</Cell> },
  { label: 'Created At', render: (r) => <Cell>{fmtDateTime(r.createdAt)}</Cell> },
  { label: 'Last Modified At', render: (r) => <Cell>{fmtDateTime(r.updatedAt)}</Cell> },
];

export default function RolesPage() {
  const { has } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('roles:create');
  const canUpdate = has('roles:update');
  const canDelete = has('roles:delete');
  const [reloadKey, setReloadKey] = useState(0);

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
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.message ?? 'Delete failed');
      else toast.error('Delete failed');
    }
  }

  return (
    <MasterList<Role>
      endpoint="/roles"
      columns={COLUMNS}
      reloadKey={reloadKey}
      addLabel={canCreate ? 'Add Role' : undefined}
      onAdd={() => navigate('/admin/roles/new')}
      rowActions={(role) => [
        {
          label: canUpdate ? 'Edit' : 'View',
          icon: canUpdate ? icons.pencil : icons.eye,
          onClick: () => navigate(`/admin/roles/${role.id}`),
        },
        // The superuser role cannot be deleted.
        ...(canDelete && role.name !== 'admin'
          ? [{ label: 'Delete', icon: icons.trash, onClick: () => handleDelete(role) }]
          : []),
      ]}
    />
  );
}
