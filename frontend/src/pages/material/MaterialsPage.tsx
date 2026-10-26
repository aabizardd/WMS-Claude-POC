import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Material } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import ErpSyncModal from '../../components/master/ErpSyncModal';
import { Cell, StatusPill, fmtDateTime, icons } from '../../components/master/MasterKit';

const num = (n: number | null | undefined) => (n == null ? '-' : n);

// WMS dev's Material Info columns. For ERP items code & name come from Oracle;
// the other fields are edited on the material's page.
const COLUMNS: MasterColumn<Material>[] = [
  { label: 'Status', width: 120, render: (m) => <StatusPill active={m.is_active} /> },
  { label: 'Material Code', sortKey: 'material_code', render: (m) => <Cell>{m.material_code}</Cell> },
  { label: 'Material Name', sortKey: 'material_name', render: (m) => <Cell>{m.material_name}</Cell> },
  { label: 'Material Type', sortKey: 'material_type', render: (m) => <Cell>{m.material_type?.material_type_name}</Cell> },
  {
    label: 'Material Category Name',
    sortKey: 'material_category',
    render: (m) => <Cell>{m.material_category?.material_category_name}</Cell>,
  },
  { label: 'Primary UoM', sortKey: 'primary_uom', render: (m) => <Cell>{m.primary_uom?.uom_code}</Cell> },
  { label: 'Secondary UoM', render: (m) => <Cell>{m.secondary_uom?.uom_code}</Cell> },
  { label: 'Conversion Rate', render: (m) => <Cell>{num(m.conversion_rate_quantity)}</Cell> },
  { label: 'Material Length', render: (m) => <Cell>{num(m.material_length)}</Cell> },
  { label: 'Material Width', render: (m) => <Cell>{num(m.material_width)}</Cell> },
  { label: 'Material Height', render: (m) => <Cell>{num(m.material_height)}</Cell> },
  { label: 'UoD', render: (m) => <Cell>{m.dimension_uom?.uom_code}</Cell> },
  { label: 'Material Weight', render: (m) => <Cell>{num(m.material_weight)}</Cell> },
  { label: 'Weight UoM', render: (m) => <Cell>{m.weight_uom?.uom_code}</Cell> },
  { label: 'Material Photo', render: (m) => <Cell>{m.photos.length > 0 ? `${m.photos.length} photo(s)` : null}</Cell> },
  { label: 'Created By', render: (m) => <Cell>{m.created_by}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (m) => <Cell>{fmtDateTime(m.created_at)}</Cell> },
  { label: 'Last Modified By', render: (m) => <Cell>{m.modified_by}</Cell> },
  { label: 'Last Modified At', sortKey: 'modified_at', render: (m) => <Cell>{fmtDateTime(m.modified_at)}</Cell> },
];

export default function MaterialsPage() {
  const { has } = useAuth();
  const navigate = useNavigate();
  const canUpdate = has('materials:update');
  const [syncOpen, setSyncOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <MasterList<Material>
        endpoint="/materials"
        columns={COLUMNS}
        reloadKey={reloadKey}
        menuActions={
          has('materials:sync')
            ? [{ label: 'Sync from ERP', icon: icons.cloudSync, onClick: () => setSyncOpen(true) }]
            : []
        }
        rowActions={(m) => [
          {
            label: canUpdate ? 'Edit' : 'View',
            icon: canUpdate ? icons.pencil : icons.eye,
            onClick: () => navigate(`/admin/materials/${m.id}/edit`),
          },
        ]}
      />
      <ErpSyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        base="/materials"
        noun="materials"
        onSynced={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
