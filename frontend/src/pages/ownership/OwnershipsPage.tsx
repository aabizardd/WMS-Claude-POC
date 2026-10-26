import { useState } from 'react';
import type { Ownership, OwnershipType } from '../../types';
import { useAuth } from '../../context/AuthContext';
import MasterList, { type MasterColumn } from '../../components/master/MasterList';
import ErpSyncModal from '../../components/master/ErpSyncModal';
import { Cell, fmtDateTime, icons } from '../../components/master/MasterKit';

/** Sync endpoints of the two masters behind this list. */
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
 * separated by Ownership Type. Both stay synced from Oracle (read-only).
 */
export default function OwnershipsPage() {
  const { has } = useAuth();
  const [syncType, setSyncType] = useState<OwnershipType | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const syncTypes = (Object.keys(SYNC) as OwnershipType[]).filter((t) => has(SYNC[t].permission));

  return (
    <>
      <MasterList<Ownership>
        endpoint="/ownerships"
        columns={COLUMNS}
        reloadKey={reloadKey}
        menuActions={syncTypes.map((t) => ({
          label: `Sync ${t}s`,
          icon: icons.cloudSync,
          onClick: () => setSyncType(t),
        }))}
      />
      <ErpSyncModal
        open={syncType !== null}
        onClose={() => setSyncType(null)}
        base={syncType ? SYNC[syncType].base : '/vendors'}
        noun={syncType ? SYNC[syncType].noun : ''}
        onSynced={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
