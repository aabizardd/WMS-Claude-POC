import type { PibHistoryRow } from '../../../types';
import MasterList, { type MasterColumn } from '../../../components/master/MasterList';
import { Cell, fmtDateTime } from '../../../components/master/MasterKit';
import { PageCard, qty } from '../../../components/wms/DocKit';

// One row per material put away, as WMS dev's History.
const COLUMNS: MasterColumn<PibHistoryRow>[] = [
  { label: 'Transaction ID', render: (r) => <Cell>{r.transaction_id}</Cell> },
  { label: 'Nomor Aju', render: (r) => <Cell>{r.aju_number}</Cell> },
  { label: 'PO Number', render: (r) => <Cell>{r.po_number}</Cell> },
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
  { label: 'Supplier', render: (r) => <Cell>{r.supplier}</Cell> },
  { label: 'Ownership', render: (r) => <Cell>{r.ownership}</Cell> },
  { label: 'Created By', render: (r) => <Cell>{r.created_by}</Cell> },
  { label: 'Created At', render: (r) => <Cell>{fmtDateTime(r.created_at)}</Cell> },
];

/** History - PIB, as on WMS dev (with the shipment's Nomor Aju). */
export default function PibHistoryPage() {
  return (
    <PageCard title="History - PIB" description="Track all inbound activity logs for pib">
      <MasterList<PibHistoryRow>
        endpoint="/pib-inbound/history"
        columns={COLUMNS}
        searchPlaceholder="Search by ID, PO, or Material..."
      />
    </PageCard>
  );
}
