import { useState } from 'react';
import type { Warehouse } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import ErpSyncModal from '../../components/master/ErpSyncModal';
import { Cell, StatusPill, fmtDateTime, icons } from '../../components/master/MasterKit';

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
  const [syncOpen, setSyncOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <MasterList<Warehouse>
        endpoint="/warehouses"
        columns={COLUMNS}
        reloadKey={reloadKey}
        menuActions={
          has('warehouses:sync')
            ? [{ label: 'Sync from ERP', icon: icons.cloudSync, onClick: () => setSyncOpen(true) }]
            : []
        }
      />
      <ErpSyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        base="/warehouses"
        noun="warehouses"
        onSynced={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
