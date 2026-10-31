import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { OutboundHistoryRow, Paginated } from '../../types';
import TablePager from '../../components/TablePager';
import { ListHeader } from '../../components/ListView';
import { formatDateTime } from './deliveryColumns';
import { fmtQty } from './outboundLines';

/**
 * Outbound History, as on WMS dev: one row per picked material, following it
 * through packing and delivery — requested, picked, packed and delivered. A
 * plain table, no filters.
 */
export default function HistoryList({ source }: { source?: 'SALES_ORDER' | 'TRANSFER_ORDER'; basePath?: string } = {}) {
  const isTransfer = source === 'TRANSFER_ORDER';
  const [data, setData] = useState<Paginated<OutboundHistoryRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<Paginated<OutboundHistoryRow>>('/picking/history', {
        params: {
          page,
          limit: pageSize,
          source: source || undefined,
        },
      })
      .then((r) => active && setData(r.data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page, pageSize, source]);

  const rows = data?.rows ?? [];
  const head = [
    'No',
    isTransfer ? 'TO ID' : 'SDO ID',
    'Picking ID',
    'Packing ID',
    'Delivery ID',
    'ERP Doc ID',
    'Doc Type',
    'Box Number',
    'Ownership',
    isTransfer ? 'Origin Warehouse' : 'Warehouse Name',
    isTransfer ? 'Destination Warehouse' : 'Customer Name',
    'Material Code',
    'Material Name',
    'Material Category',
    'Material Classification',
    'UoM',
    'Req Qty',
    'Picked Qty',
    'Packed Qty',
    'Delivered Qty',
    'Material Dimension',
    'Material Weight',
    'Created By',
    'Created At',
  ];
  const qtyCols = new Set(['Req Qty', 'Picked Qty', 'Packed Qty', 'Delivered Qty', 'Material Weight']);
  const td = 'whitespace-nowrap px-4 py-3 text-slate-700';

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader title="Outbound History" subtitle="Track all outbound delivery activity logs" />
      </div>

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr>
                {head.map((h) => (
                  <th key={h} className={`whitespace-nowrap px-4 py-3 font-medium ${qtyCols.has(h) ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={head.length} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                    <td className={`${td} text-slate-800`}>{r.outbound_id ?? '-'}</td>
                    <td className={td}>{r.picking_id}</td>
                    <td className={td}>{r.packing_id ?? '-'}</td>
                    <td className={td}>{r.delivery_id ?? '-'}</td>
                    <td className={td}>{r.erp_doc_id ?? '-'}</td>
                    <td className={td}>{r.doc_type}</td>
                    <td className={td}>-</td>
                    <td className={td}>{r.ownership ?? '-'}</td>
                    <td className={td}>{r.warehouse ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.customer ?? '-'}</td>
                    <td className={`${td} text-slate-800`}>{r.material_code ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.material_name ?? '-'}</td>
                    <td className={td}>{r.material_category ?? '-'}</td>
                    <td className={td}>{r.material_classification ?? '-'}</td>
                    <td className={td}>{r.uom ?? '-'}</td>
                    <td className={`${td} text-right`}>{fmtQty(r.request_qty)}</td>
                    <td className={`${td} text-right`}>{fmtQty(r.picked_qty)}</td>
                    <td className={`${td} text-right`}>{fmtQty(r.packed_qty)}</td>
                    <td className={`${td} text-right`}>{fmtQty(r.delivered_qty)}</td>
                    <td className={td}>{r.material_dimension ?? '-'}</td>
                    <td className={`${td} text-right`}>{fmtQty(r.material_weight)}</td>
                    <td className={td}>{r.created_by ?? '-'}</td>
                    <td className={td}>{formatDateTime(r.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={head.length} className="px-6 py-10 text-center text-slate-400">
                    No outbound activity yet.
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
