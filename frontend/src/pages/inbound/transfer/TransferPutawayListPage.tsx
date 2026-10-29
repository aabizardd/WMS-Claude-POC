import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TransferPutawayRow } from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../context/ConfirmContext';
import MasterList, { type MasterColumn } from '../../../components/master/MasterList';
import { Cell, fmtDateTime, icons } from '../../../components/master/MasterKit';
import { DocStatusPill, PageCard } from '../../../components/wms/DocKit';
import { deleteTransferDoc } from './transferInbound';

const BASE = '/admin/inbound/transfer';

const COLUMNS: MasterColumn<TransferPutawayRow>[] = [
  { label: 'Status', sortKey: 'status', width: 150, render: (r) => <DocStatusPill status={r.status} /> },
  { label: 'Transaction ID', sortKey: 'transaction_id', render: (r) => <Cell>{r.transaction_id}</Cell> },
  { label: 'Putaway ID', sortKey: 'putaway_code', render: (r) => <Cell>{r.putaway_code}</Cell> },
  { label: 'GR ID', sortKey: 'gr_number', render: (r) => <Cell>{r.gr_number}</Cell> },
  { label: 'Destination Location', render: (r) => <Cell>{r.destination_location}</Cell> },
  { label: 'Ownership', render: (r) => <Cell>{r.ownership}</Cell> },
  { label: 'Warehouse', sortKey: 'warehouse', render: (r) => <Cell>{r.warehouse}</Cell> },
  { label: 'Created At', sortKey: 'created_at', render: (r) => <Cell>{fmtDateTime(r.created_at)}</Cell> },
  { label: 'Last Modified At', sortKey: 'updated_at', render: (r) => <Cell>{fmtDateTime(r.updated_at)}</Cell> },
];

/** Putaway - TO, as on WMS dev. */
export default function TransferPutawayListPage() {
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <PageCard title="Putaway - TO" description="Move items to their storage locations for transfer order">
      <MasterList<TransferPutawayRow>
        endpoint="/transfer-inbound/putaway"
        columns={COLUMNS}
        reloadKey={reloadKey}
        searchPlaceholder="Search by ID..."
        rowActions={(r) => [
          { label: 'Detail', icon: icons.eye, onClick: () => navigate(`${BASE}/putaway/${r.id}`) },
          ...(has('putaway:delete') && r.can_delete
            ? [
                {
                  label: 'Delete',
                  icon: icons.trash,
                  onClick: async () => {
                    if (await deleteTransferDoc('putaway', r.id, r.putaway_code, confirm, toast))
                      setReloadKey((k) => k + 1);
                  },
                },
              ]
            : []),
          ...(r.gr_id
            ? [{ label: 'GR List Detail', icon: icons.fileText, onClick: () => navigate(`${BASE}/goods-receive/${r.gr_id}`) }]
            : []),
        ]}
      />
    </PageCard>
  );
}
