import type { TransferHistoryRow } from '../../../types';
import MasterList, { type MasterColumn } from '../../../components/master/MasterList';
import { Cell, fmtDateTime } from '../../../components/master/MasterKit';
import { PageCard, qty } from '../../../components/wms/DocKit';

// One row per material put away, as WMS dev's History.
const COLUMNS: MasterColumn<TransferHistoryRow>[] = [
  { label: 'Transaction ID', render: (r) => <Cell>{r.transaction_id}</Cell> },
  { label: 'GR ID', render: (r) => <Cell>{r.gr_number}</Cell> },
  { label: 'Putaway ID', render: (r) => <Cell>{r.putaway_code}</Cell> },
  { label: 'Material Code', render: (r) => <Cell>{r.material_code}</Cell> },
  { label: 'Material Name', render: (r) => <Cell>{r.material_name}</Cell> },
  { label: 'Material Type', render: (r) => <Cell>{r.material_type}</Cell> },
  { label: 'Material Category', render: (r) => <Cell>{r.material_category}</Cell> },
  { label: 'Request Quantity', render: (r) => <Cell>{qty(r.request_qty)}</Cell> },
  { label: 'Receive Quantity', render: (r) => <Cell>{qty(r.receive_qty)}</Cell> },
  { label: 'Warehouse', render: (r) => <Cell>{r.warehouse}</Cell> },
  { label: 'Destination Bin', render: (r) => <Cell>{r.destination_bin}</Cell> },
  { label: 'Origin Warehouse', render: (r) => <Cell>{r.origin_warehouse}</Cell> },
  { label: 'Ownership', render: (r) => <Cell>{r.ownership}</Cell> },
  { label: 'Created At', render: (r) => <Cell>{fmtDateTime(r.created_at)}</Cell> },
];

/** History - TO, as on WMS dev. */
export default function TransferHistoryPage() {
  return (
    <PageCard title="History - TO" description="Track all inbound activity logs for transfer order">
      <MasterList<TransferHistoryRow>
        endpoint="/transfer-inbound/history"
        columns={COLUMNS}
        searchPlaceholder="Search by ID, PO, or Material..."
      />
    </PageCard>
  );
}
