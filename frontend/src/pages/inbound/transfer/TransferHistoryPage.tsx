import type { TransferHistoryRow } from '../../../types';
import MasterList, { type MasterColumn } from '../../../components/master/MasterList';
import { Cell, fmtDateTime } from '../../../components/master/MasterKit';
import { PageCard, qty } from '../../../components/wms/DocKit';
import { TRANSFER_IN, type InboundSource } from './inboundSource';

// One row per material put away, as WMS dev's History.
const columns = (source: InboundSource): MasterColumn<TransferHistoryRow>[] => [
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
  source.code === 'PO'
    ? { label: 'Supplier', render: (r) => <Cell>{r.supplier}</Cell> }
    : { label: 'Origin Warehouse', render: (r) => <Cell>{r.origin_warehouse}</Cell> },
  { label: 'Ownership', render: (r) => <Cell>{r.ownership}</Cell> },
  { label: 'Created At', render: (r) => <Cell>{fmtDateTime(r.created_at)}</Cell> },
];

/** History - TO / PO, as on WMS dev. */
export default function TransferHistoryPage({ source = TRANSFER_IN }: { source?: InboundSource } = {}) {
  return (
    <PageCard title={`History - ${source.code}`} description={`Track all inbound activity logs for ${source.noun}`}>
      <MasterList<TransferHistoryRow>
        endpoint={`${source.api}/history`}
        columns={columns(source)}
        searchPlaceholder="Search by ID, PO, or Material..."
      />
    </PageCard>
  );
}
