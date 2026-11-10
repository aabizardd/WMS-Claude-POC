import type { Ownership, OwnershipType } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import { syncManyFromErp } from '../../components/master/erpSync';
import { useToast } from '../../context/ToastContext';
import { Cell, fmtDateTime } from '../../components/master/MasterKit';

/** Sync endpoints of the two masters behind this list; one refresh syncs both. */
const SYNC: Record<OwnershipType, { base: string; permission: string; noun: string }> = {
  Vendor: { base: '/vendors', permission: 'vendors:sync', noun: 'vendors' },
  Customer: { base: '/customers', permission: 'customers:sync', noun: 'customers' },
};

// WMS dev's Ownership columns. Vendors and customers carry no active flag in
// Oracle, so there is no Status column.
const COLUMNS: MasterColumn<Ownership>[] = [
  { label: 'Owner Code', sortKey: 'oracle_id', render: (o) => <Cell>{o.oracle_id}</Cell> },
  { label: 'Owner Name', sortKey: 'company_name', render: (o) => <Cell>{o.company_name ?? o.entity_id}</Cell> },
  { label: 'Ownership Type', sortKey: 'type', render: (o) => <Cell>{`${o.type}s`}</Cell> },
  { label: 'Contact Number', sortKey: 'phone', render: (o) => <Cell>{o.phone}</Cell> },
  { label: 'Email', sortKey: 'email', render: (o) => <Cell>{o.email}</Cell> },
  { label: 'Subsidiary', sortKey: 'subsidiary_display', render: (o) => <Cell>{o.subsidiary_display}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (o) => <Cell>{fmtDateTime(o.created_at)}</Cell> },
  { label: 'Last Modified At', sortKey: 'last_modified', render: (o) => <Cell>{fmtDateTime(o.last_modified)}</Cell> },
];

/**
 * Ownership Setting, as on WMS dev: vendors and customers in one list,
 * separated by Ownership Type. Both stay synced from Oracle (read-only); the
 * refresh button pulls vendors, then customers, straight away.
 */
export default function OwnershipsPage() {
  const { has } = useAuth();
  const toast = useToast();
  // Only the masters this user may sync; with neither, refresh just reloads.
  const targets = (Object.keys(SYNC) as OwnershipType[]).filter((t) => has(SYNC[t].permission)).map((t) => SYNC[t]);

  return (
    <MasterList<Ownership>
      endpoint="/ownerships"
      columns={COLUMNS}
      onRefresh={targets.length ? () => syncManyFromErp(targets, toast) : undefined}
      refreshTitle={targets.length ? 'Sync from ERP' : undefined}
    />
  );
}
