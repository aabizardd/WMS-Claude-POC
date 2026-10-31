import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import type { Paginated, PickingRow } from '../../types';
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

/**
 * Picking List, as on WMS dev: the pickings not packed yet, in a plain table
 * (no filters, no accordion). Ticking Closed pickings of one order and "Add
 * Packing" merges them into one packing. Shared by the Sales Order and Transfer Stock tabs —
 * `source` filters by origin, `basePath` drives the links.
 */
export default function PickingList({
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
  const canDelete = has('picking:delete');
  const canPack = has('packing:create');

  const [data, setData] = useState<Paginated<PickingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Order of every id ever ticked — selection spans pages, so this is the only
  // place an off-page picking's order is known (for the same-order guard).
  const orderById = useRef(new Map<string, string>());
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
      .get<Paginated<PickingRow>>('/picking', {
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
  const packable = rows.filter((r) => r.status === 'Closed');
  const allTicked = packable.length > 0 && packable.every((r) => selected.has(r.id));

  function tick(r: PickingRow) {
    orderById.current.set(r.id, r.source_number ?? '');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
  }
  function tickAll() {
    packable.forEach((r) => orderById.current.set(r.id, r.source_number ?? ''));
    setSelected((prev) => {
      const next = new Set(prev);
      packable.forEach((r) => (allTicked ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }

  async function addPacking() {
    if (selected.size === 0) {
      toast.info('Tick the Closed pickings to pack first.');
      return;
    }
    // They merge into one packing, so they must share an order (the server re-checks).
    const orders = new Set([...selected].map((id) => orderById.current.get(id) ?? ''));
    if (orders.size > 1) {
      toast.error(`The pickings must belong to one order (ticked: ${[...orders].filter(Boolean).join(', ')})`);
      return;
    }
    const ok = await confirm({
      title: 'Add Packing?',
      description: `${selected.size} picking(s) will be merged into one packing and move to the Packing List.`,
      type: 'info',
      confirmText: 'Add Packing',
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await api.post<{ created: number; packing_codes?: string[] }>('/packing/generate', {
        pickingIds: [...selected],
      });
      toast.success(
        r.data.packing_codes?.length ? `Packing created: ${r.data.packing_codes.join(', ')}` : 'Packing created',
      );
      setSelected(new Set());
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(apiError(err, 'Add Packing failed'));
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
          title="Picking List"
          subtitle="Pick items from storage based on order details"
          actions={
            canPack && (
              <button className="btn-primary" onClick={addPacking} disabled={generating}>
                {generating ? 'Adding…' : 'Add Packing'}
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
                  {canPack && (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      checked={allTicked}
                      disabled={packable.length === 0}
                      onChange={tickAll}
                      aria-label="Select every Closed picking on this page"
                    />
                  )}
                </th>
                <th className="px-4 py-3 font-medium">No</th>
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Transaction ID" col="so_number" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">{isTransfer ? 'TO ID' : 'SO ID'}</th>
                <SortableTh label="Picking ID" col="picking_code" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Picking Progress</th>
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
                  const detailPath = `${basePath}/picking/${p.id}`;
                  const orderPath = isTransfer
                    ? p.to_id && `/admin/outbound/transfer-stock/list/${p.to_id}`
                    : p.so_id && `/admin/outbound/sales-order/list/${p.so_id}`;
                  return (
                    <tr key={p.id} className={`hover:bg-slate-50 ${loading ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-3">
                        {canPack && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                            checked={selected.has(p.id)}
                            disabled={p.status !== 'Closed'}
                            title={p.status === 'Closed' ? undefined : 'Only a Closed picking can be packed'}
                            onChange={() => tick(p)}
                            aria-label={`Select ${p.picking_id}`}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="px-4 py-3">
                        <DocStatusPill status={p.status} />
                      </td>
                      <td className={`${td} text-slate-800`}>{p.source_number ?? '-'}</td>
                      <td className={td}>{p.outbound_id ?? '-'}</td>
                      <td className={`${td} text-slate-800`}>{p.picking_id}</td>
                      <td className={td}>
                        {p.progress.done}/{p.progress.total}
                      </td>
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
                            ...(orderPath
                              ? [{ label: isTransfer ? 'TO Detail' : 'SDO Detail', icon: <DetailIcon />, onClick: () => navigate(orderPath) }]
                              : []),
                            ...(canDelete && p.status === 'Open'
                              ? [
                                  {
                                    label: 'Delete',
                                    icon: <TrashIcon />,
                                    onClick: async () => {
                                      if (await deleteOutboundDoc('picking', p.id, p.picking_id, confirm, toast))
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
                    No picking documents yet.
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

