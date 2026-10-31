import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import type { PackingRow, Paginated } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';
import RowActionMenu from '../../components/RowActionMenu';
import TablePager from '../../components/TablePager';
import { TrashIcon } from '../../components/icons';
import { DocStatusPill } from '../../components/wms/DocKit';
import { DetailIcon, ListHeader } from '../../components/ListView';
import { apiError } from '../inbound/transfer/transferInbound';
import { deleteOutboundDoc } from './outboundDelete';
import { formatDateTime } from './deliveryColumns';

// select, No, 12 data columns, Actions.
const COLS = 15;

/** "PICK-20261027-00059" and "+1" for the other merged pickings. */
export function PickingIds({ pickings }: { pickings: { picking_id: string }[] }) {
  if (!pickings.length) return <>-</>;
  return (
    <span className="inline-flex items-center gap-1.5" title={pickings.map((p) => p.picking_id).join(', ')}>
      {pickings[0].picking_id}
      {pickings.length > 1 && (
        <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600">+{pickings.length - 1}</span>
      )}
    </span>
  );
}

/**
 * Packing List, as on WMS dev: the packings not on a delivery plan yet, in a
 * plain table (no filters, no accordion). Ticking Closed packings and "Generate Delivery
 * Plan" puts them on one delivery plan. Shared by the Sales Order and
 * Transfer Stock tabs.
 */
export default function PackingList({
  source,
  basePath = '/admin/outbound/sales-order',
}: {
  source?: 'SALES_ORDER' | 'TRANSFER_ORDER';
  basePath?: string;
} = {}) {
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isTransfer = source === 'TRANSFER_ORDER';
  const canDelete = has('packing:delete');
  const canDeliver = has('delivery:create');

  const [data, setData] = useState<Paginated<PackingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<Paginated<PackingRow>>('/packing', {
        params: {
          page,
          limit: pageSize,
          source: source || undefined,
          ...params(),
        },
      })
      .then((r) => active && setData(r.data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, source, sort.sortBy, sort.order, reloadKey]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const deliverable = rows.filter((r) => r.status === 'Closed');
  const allTicked = deliverable.length > 0 && deliverable.every((r) => selected.has(r.id));

  function tick(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generateDelivery() {
    if (selected.size === 0) {
      toast.info('Tick the Closed packings to deliver first.');
      return;
    }
    const ok = await confirm({
      title: 'Generate Delivery Plan?',
      description: `${selected.size} packing(s) will be put on a delivery plan and move to the Delivery Plan list.`,
      type: 'info',
      confirmText: 'Generate',
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await api.post<{ created: number }>('/delivery/generate', { packingIds: [...selected] });
      toast.success(`${r.data.created} delivery plan(s) created`);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(apiError(err, 'Generate Delivery Plan failed'));
    } finally {
      setGenerating(false);
    }
  }

  const th = 'whitespace-nowrap';
  const td = 'whitespace-nowrap px-4 py-3 text-slate-700';

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Packing List"
          subtitle="Pack and verify items before shipment"
          actions={
            canDeliver && (
              <button className="btn-primary" onClick={generateDelivery} disabled={generating}>
                {generating ? 'Generating…' : 'Generate Delivery Plan'}
                {selected.size > 0 && <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">{selected.size}</span>}
              </button>
            )
          }
        />
      </div>

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr className="[&>th]:font-medium [&_button]:normal-case [&_button]:tracking-normal">
                <th className="w-10 px-3 py-3">
                  {canDeliver && (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      checked={allTicked}
                      disabled={deliverable.length === 0}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          deliverable.forEach((r) => (allTicked ? next.delete(r.id) : next.add(r.id)));
                          return next;
                        })
                      }
                      aria-label="Select every Closed packing on this page"
                    />
                  )}
                </th>
                <th className="px-4 py-3 font-medium">No</th>
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Transaction ID" col="so_number" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">{isTransfer ? 'TO ID' : 'SO ID'}</th>
                <SortableTh label="Picking ID" col="picking_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Packing ID" col="packing_code" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Ownership</th>
                <SortableTh
                  label={isTransfer ? 'Origin Warehouse' : 'Warehouse Name'}
                  col="location"
                  sort={sort}
                  onSort={onSort}
                  pad="px-4"
                  className={th}
                />
                <SortableTh
                  label={isTransfer ? 'Destination Warehouse' : 'Customer Name'}
                  col="customer"
                  sort={sort}
                  onSort={onSort}
                  pad="px-4"
                  className={th}
                />
                <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Created At" col="created_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Last Modified By</th>
                <SortableTh label="Last Modified At" col="updated_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((p, i) => {
                  const detailPath = `${basePath}/packing/${p.id}`;
                  return (
                    <tr key={p.id} className={`hover:bg-slate-50 ${loading ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-3">
                        {canDeliver && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                            checked={selected.has(p.id)}
                            disabled={p.status !== 'Closed'}
                            title={p.status === 'Closed' ? undefined : 'Only a Closed packing can be delivered'}
                            onChange={() => tick(p.id)}
                            aria-label={`Select ${p.packing_id}`}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="px-4 py-3">
                        <DocStatusPill status={p.status} />
                      </td>
                      <td className={`${td} text-slate-800`}>{p.source_number ?? '-'}</td>
                      <td className={td}>{p.outbound_id ?? '-'}</td>
                      <td className={td}>
                        <PickingIds pickings={p.pickings} />
                      </td>
                      <td className={`${td} text-slate-800`}>{p.packing_id}</td>
                      <td className={td}>{p.ownership ?? '-'}</td>
                      <td className={td}>{p.location ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{p.customer ?? '-'}</td>
                      <td className={td}>{p.created_by ?? '-'}</td>
                      <td className={td}>{formatDateTime(p.created_at)}</td>
                      <td className={td}>{p.updated_by ?? '-'}</td>
                      <td className={td}>{p.updated_by ? formatDateTime(p.updated_at) : '-'}</td>
                      <td className="sticky right-0 bg-white px-4 py-3 text-center shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                        <RowActionMenu
                          actions={[
                            { label: 'Detail', icon: <DetailIcon />, onClick: () => navigate(detailPath) },
                            ...(canDelete && p.status === 'Open'
                              ? [
                                  {
                                    label: 'Delete',
                                    icon: <TrashIcon />,
                                    onClick: async () => {
                                      if (await deleteOutboundDoc('packing', p.id, p.packing_id, confirm, toast))
                                        setReloadKey((k) => k + 1);
                                    },
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    No packing documents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="px-1 pb-1 pt-2">
        <TablePager
          page={page}
          pageSize={pageSize}
          total={data?.total_data ?? 0}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}

