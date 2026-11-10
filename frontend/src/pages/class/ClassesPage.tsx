import type { ClassMaster } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { syncFromErp } from '../../components/master/erpSync';
import { useToast } from '../../context/ToastContext';
import { Cell, StatusPill, fmtDateTime } from '../../components/master/MasterKit';

// Synced from Oracle (read-only), so rows have no actions.
const COLUMNS: MasterColumn<ClassMaster>[] = [
  { label: 'Status', sortKey: 'is_inactive', width: 120, render: (r) => <StatusPill active={!r.is_inactive} /> },
  { label: 'Class ID', sortKey: 'oracle_id', render: (r) => <Cell>{r.oracle_id}</Cell> },
  { label: 'Class Name', sortKey: 'name', render: (r) => <Cell>{r.name}</Cell> },
  { label: 'Parent', sortKey: 'parent_name', render: (r) => <Cell>{r.parent_name}</Cell> },
  { label: 'Subsidiary', sortKey: 'subsidiary_name', render: (r) => <Cell>{r.subsidiary_name}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (r) => <Cell>{fmtDateTime(r.created_at)}</Cell> },
  { label: 'Last Modified At', sortKey: 'last_modified', render: (r) => <Cell>{fmtDateTime(r.last_modified)}</Cell> },
];

export default function ClassesPage() {
  const { has } = useAuth();
  const toast = useToast();

  return (
    <MasterList<ClassMaster>
      endpoint="/classes"
      columns={COLUMNS}
      // Refresh pulls the latest from Oracle first (with the sync permission).
      onRefresh={has('classes:sync') ? () => syncFromErp('/classes', 'classes', toast) : undefined}
      refreshTitle={has('classes:sync') ? 'Sync from ERP' : undefined}
    />
  );
}
