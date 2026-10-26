import { useState } from 'react';
import type { Subsidiary } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import ErpSyncModal from '../../components/master/ErpSyncModal';
import { Cell, StatusPill, fmtDateTime, icons } from '../../components/master/MasterKit';

// Synced from Oracle (read-only), so rows have no actions.
const COLUMNS: MasterColumn<Subsidiary>[] = [
  { label: 'Status', sortKey: 'is_delete', width: 120, render: (s) => <StatusPill active={!s.is_delete} /> },
  { label: 'Subsidiary ID', sortKey: 'oracle_id', render: (s) => <Cell>{s.oracle_id}</Cell> },
  { label: 'Subsidiary Name', sortKey: 'name', render: (s) => <Cell>{s.name}</Cell> },
  { label: 'Full Name', sortKey: 'full_name', render: (s) => <Cell>{s.full_name}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (s) => <Cell>{fmtDateTime(s.created_at)}</Cell> },
  { label: 'Last Modified At', sortKey: 'last_modified', render: (s) => <Cell>{fmtDateTime(s.last_modified)}</Cell> },
];

export default function SubsidiariesPage() {
  const { has } = useAuth();
  const [syncOpen, setSyncOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <MasterList<Subsidiary>
        endpoint="/subsidiaries"
        columns={COLUMNS}
        reloadKey={reloadKey}
        menuActions={
          has('subsidiaries:sync')
            ? [{ label: 'Sync from ERP', icon: icons.cloudSync, onClick: () => setSyncOpen(true) }]
            : []
        }
      />
      <ErpSyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        base="/subsidiaries"
        noun="subsidiaries"
        onSynced={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
