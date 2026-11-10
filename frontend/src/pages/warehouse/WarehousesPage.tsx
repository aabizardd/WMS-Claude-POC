import type { Warehouse } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { syncFromErp } from '../../components/master/erpSync';
import { useToast } from '../../context/ToastContext';
import { Cell, StatusPill, fmtDateTime } from '../../components/master/MasterKit';

// Synced from Oracle (read-only), so rows have no actions.
const COLUMNS: MasterColumn<Warehouse>[] = [
  { label: 'Status', sortKey: 'status', width: 120, render: (w) => <StatusPill active={!w.is_inactive} /> },
  { label: 'Warehouse Code', sortKey: 'oracle_id', render: (w) => <Cell>{w.oracle_id}</Cell> },
  { label: 'Warehouse Name', sortKey: 'name', render: (w) => <Cell>{w.name}</Cell> },
  { label: 'Location Type', sortKey: 'type', render: (w) => <Cell>{w.location_type_name}</Cell> },
  { label: 'Parent', sortKey: 'parent', render: (w) => <Cell>{w.parent_name}</Cell> },
  { label: 'Subsidiary', sortKey: 'subsidiary', render: (w) => <Cell>{w.subsidiary_name}</Cell> },
  { label: 'Timezone', sortKey: 'timezone', render: (w) => <Cell>{w.timezone}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (w) => <Cell>{fmtDateTime(w.created_at)}</Cell> },
  { label: 'Last Modified At', sortKey: 'last_modified', render: (w) => <Cell>{fmtDateTime(w.last_modified)}</Cell> },
];

export default function WarehousesPage() {
  const { has } = useAuth();
  const toast = useToast();

  return (
    <MasterList<Warehouse>
      endpoint="/warehouses"
      columns={COLUMNS}
      // Refresh pulls the latest from Oracle first (with the sync permission).
      onRefresh={has('warehouses:sync') ? () => syncFromErp('/warehouses', 'warehouses', toast) : undefined}
      refreshTitle={has('warehouses:sync') ? 'Sync from ERP' : undefined}
    />
  );
}
