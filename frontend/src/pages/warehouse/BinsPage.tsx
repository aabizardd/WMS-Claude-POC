import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Bin } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { Cell, StatusPill, fmtDateTime, icons } from '../../components/master/MasterKit';

// WMS dev's Bin columns; the volume is length × width × height.
const COLUMNS: MasterColumn<Bin>[] = [
  { label: 'Status', sortKey: 'status', width: 120, render: (b) => <StatusPill active={b.is_active} /> },
  { label: 'Bin ID', sortKey: 'bin_code', render: (b) => <Cell>{b.bin_code}</Cell> },
  { label: 'Warehouse Name', sortKey: 'warehouse', render: (b) => <Cell>{b.warehouse_name?.warehouse_name}</Cell> },
  { label: 'Aisle Name', sortKey: 'aisle', render: (b) => <Cell>{b.aisle?.aisle_name}</Cell> },
  { label: 'Shelf Label', sortKey: 'shelf', render: (b) => <Cell>{b.shelf?.shelf_label}</Cell> },
  { label: 'Bin Label', sortKey: 'bin_label', render: (b) => <Cell>{b.bin_label}</Cell> },
  { label: 'Bin Length', render: (b) => <Cell>{b.bin_length}</Cell> },
  { label: 'Bin Width', render: (b) => <Cell>{b.bin_width}</Cell> },
  { label: 'Bin Height', render: (b) => <Cell>{b.bin_height}</Cell> },
  {
    label: 'UoM',
    render: (b) => (
      <Cell>
        {b.dimension_uom?.uom_code
          ? `${b.dimension_uom.uom_code}${b.dimension_uom.uom_name ? ` - ${b.dimension_uom.uom_name}` : ''}`
          : null}
      </Cell>
    ),
  },
  { label: 'Bin Volume', render: (b) => <Cell>{b.bin_length * b.bin_width * b.bin_height}</Cell> },
  { label: 'Created By', render: (b) => <Cell>{b.created_by}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (b) => <Cell>{fmtDateTime(b.created_at)}</Cell> },
  { label: 'Last Modified By', render: (b) => <Cell>{b.modified_by}</Cell> },
  { label: 'Last Modified At', render: (b) => <Cell>{fmtDateTime(b.modified_at)}</Cell> },
];

export default function BinsPage() {
  const { has } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('bins:create');
  const canUpdate = has('bins:update');
  const canDelete = has('bins:delete');
  const [reloadKey, setReloadKey] = useState(0);

  async function handleDelete(b: Bin) {
    const ok = await confirm({
      title: 'Delete bin?',
      description: `"${b.bin_label}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/bins/${b.id}`);
      toast.success('Bin deleted');
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.message ?? 'Delete failed');
      else toast.error('Delete failed');
    }
  }

  return (
    <MasterList<Bin>
      endpoint="/bins"
      columns={COLUMNS}
      reloadKey={reloadKey}
      addLabel={canCreate ? 'Add Bin Location' : undefined}
      onAdd={() => navigate('/admin/bins/new')}
      rowActions={(b) => [
        {
          label: canUpdate ? 'Edit' : 'View',
          icon: canUpdate ? icons.pencil : icons.eye,
          onClick: () => navigate(`/admin/bins/${b.id}`),
        },
        ...(canDelete ? [{ label: 'Delete', icon: icons.trash, onClick: () => handleDelete(b) }] : []),
      ]}
    />
  );
}
