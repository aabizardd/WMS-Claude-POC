import type { Department } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { syncFromErp } from '../../components/master/erpSync';
import { useToast } from '../../context/ToastContext';
import { Cell, StatusPill, fmtDateTime } from '../../components/master/MasterKit';

// Synced from Oracle (read-only), so rows have no actions.
const COLUMNS: MasterColumn<Department>[] = [
  { label: 'Status', sortKey: 'is_inactive', width: 120, render: (r) => <StatusPill active={!r.is_inactive} /> },
  { label: 'Department ID', sortKey: 'oracle_id', render: (r) => <Cell>{r.oracle_id}</Cell> },
  { label: 'Department Name', sortKey: 'name', render: (r) => <Cell>{r.name}</Cell> },
  { label: 'Parent', sortKey: 'parent_name', render: (r) => <Cell>{r.parent_name}</Cell> },
  { label: 'Subsidiary', sortKey: 'subsidiary_name', render: (r) => <Cell>{r.subsidiary_name}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (r) => <Cell>{fmtDateTime(r.created_at)}</Cell> },
  { label: 'Last Modified At', sortKey: 'last_modified', render: (r) => <Cell>{fmtDateTime(r.last_modified)}</Cell> },
];

export default function DepartmentsPage() {
  const { has } = useAuth();
  const toast = useToast();

  return (
    <MasterList<Department>
      endpoint="/departments"
      columns={COLUMNS}
      // Refresh pulls the latest from Oracle first (with the sync permission).
      onRefresh={has('departments:sync') ? () => syncFromErp('/departments', 'departments', toast) : undefined}
      refreshTitle={has('departments:sync') ? 'Sync from ERP' : undefined}
    />
  );
}
