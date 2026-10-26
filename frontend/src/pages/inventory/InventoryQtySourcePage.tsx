import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { RefreshButton } from '../../components/ListView';
import { soStatusBadgeClass } from '../../lib/salesOrderStatus';
import DocRefsCell, { type DocRef } from './DocRefsCell';
import type { QtySourceType } from './QtySourceLink';

interface SourceRow {
  doc_type: 'SO' | 'TO';
  doc_id: string;
  doc_number: string | null;
  erp_doc_id: string | null;
  status: string | null;
  party: string | null;
  references: string[];
  /** Packing codes; empty before packing. */
  packing_ids: string[];
  /** Reserved only: pickings and packings with ids, for links. */
  pickings?: DocRef[];
  packings?: DocRef[];
  /** In Transit only: shipped deliveries by SD number (id = delivery id). */
  sds?: DocRef[];
  /** In Transit only: shipped by the SDs, and received at the destination. */
  qty_delivered?: number;
  qty_received?: number;
  qty: number;
  /** Reserved only: what picking holds (picked, or requested while open). */
  qty_picking?: number;
  /** Reserved only: what closed packings packed; null before packing. */
  qty_packing?: number | null;
  /** Reserved only: picked but not packed — taken off the reservation. */
  packing_diff?: number;
}

interface QtySources {
  material_code: string;
  material_name: string | null;
  warehouse_name: string | null;
  type: QtySourceType;
  header_qty: number;
  documents_qty: number;
  /** Reserved only: stock still held for cancelled SO / TO (not listed). */
  cancelled_qty?: number;
  rows: SourceRow[];
}


const fmt = (n: number) => n.toLocaleString();

/** Outbound section a document lives under, by its source. */
const OUTBOUND_BASE: Record<'SO' | 'TO', string> = {
  SO: '/admin/outbound/sales-order',
  TO: '/admin/outbound/transfer-stock',
};


const DOC_PATH: Record<SourceRow['doc_type'], string> = {
  SO: '/admin/outbound/sales-order/list',
  TO: '/admin/outbound/transfer-stock/list',
};
/** In Transit is about receiving, so its TOs open in Inbound from Transfer Stock (TO In). */
const IN_TRANSIT_TO_PATH = '/admin/inbound/transfer/to';

/**
 * The SO / TO documents behind one inventory row's header Reserved Qty or In
 * Transit Qty. Opened in its own tab from the Inventory list and detail.
 */
export default function InventoryQtySourcePage() {
  const { id, type } = useParams<{ id: string; type: string }>();
  const isReserved = type === 'reserved';

  const [data, setData] = useState<QtySources | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!id || !type) return;
    setLoading(true);
    api
      .get<QtySources>(`/inventory/${id}/qty-sources/${type}`)
      .then((r) => {
        setData(r.data);
        setError('');
      })
      .catch((err) => {
        const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
        setError(typeof m === 'string' ? m : 'Inventory not found.');
      })
      .finally(() => setLoading(false));
  }, [id, type]);

  useEffect(() => {
    load();
  }, [load]);

  const title = isReserved ? 'Reserved Quantity' : 'In Transit Quantity';
  const gap = data ? data.header_qty - data.documents_qty : 0;
  const cancelled = data?.cancelled_qty ?? 0;
  const sum = (pick: (r: SourceRow) => number | null | undefined) =>
    (data?.rows ?? []).reduce((t, r) => t + (pick(r) ?? 0), 0);

  return (
    <div className="card p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/admin/inventory/list/${id}`}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{title} Documents</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {isReserved
                ? 'Sales Orders and Transfer Orders whose picking still holds this stock. Reserved = Qty Picking − Packing Difference − qty already shipped; Qty Packing counts closed packings only.'
                : 'Transfer Orders out of this warehouse: shipped, not received by the destination yet. In Transit = Qty Delivered (SD) − Qty Received (TO In).'}
            </p>
          </div>
        </div>
        <RefreshButton onClick={load} spinning={loading} />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : !data ? (
        <div className="py-10 text-center text-slate-400">Loading…</div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm lg:grid-cols-4">
              <Info label="Material Code" value={data.material_code} />
              <Info label="Material Name" value={data.material_name} />
              <Info label="Warehouse" value={data.warehouse_name} />
              <Info
                label={title}
                value={<span className="font-semibold text-brand-700">{fmt(data.header_qty)}</span>}
              />
            </dl>
          </div>

          {gap !== 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              The documents below account for {fmt(data.documents_qty)} of {fmt(data.header_qty)}.
              {cancelled > 0 && <> {fmt(cancelled)} is still held for cancelled SO / TO, which are not listed.</>}
              {gap - cancelled !== 0 && (
                <> {fmt(gap - cancelled)} was reserved outside a picking (e.g. a manual or seeded stock change).</>
              )}
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                    <th>No</th>
                    <th>Doc Type</th>
                    <th>Transaction ID</th>
                    <th>ERP Doc ID</th>
                    <th>Status</th>
                    <th>{isReserved ? 'Customer / Destination' : 'Destination Warehouse'}</th>
                    <th>{isReserved ? 'Picking ID' : 'SD ID'}</th>
                    <th>Packing ID</th>
                    {isReserved && (
                      <>
                        <th className="text-right">Qty Picking</th>
                        <th className="text-right">Qty Packing</th>
                        <th className="text-right">Packing Difference</th>
                      </>
                    )}
                    {!isReserved && (
                      <>
                        <th className="text-right">Qty Delivered (SD)</th>
                        <th className="text-right">Qty Received (TO In)</th>
                      </>
                    )}
                    <th className="text-right">{title}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.rows.length > 0 && (
                    <tr className="bg-brand-50 font-semibold text-brand-800">
                      <td colSpan={8} className="px-4 py-3">
                        Total · {data.rows.length} document(s)
                      </td>
                      {isReserved && (
                        <>
                          <td className="px-4 py-3 text-right">{fmt(sum((r) => r.qty_picking))}</td>
                          <td className="px-4 py-3 text-right">
                            {data.rows.some((r) => r.qty_packing != null) ? fmt(sum((r) => r.qty_packing)) : ''}
                          </td>
                          <td className="px-4 py-3 text-right">{fmt(sum((r) => r.packing_diff))}</td>
                        </>
                      )}
                      {!isReserved && (
                        <>
                          <td className="px-4 py-3 text-right">{fmt(sum((r) => r.qty_delivered))}</td>
                          <td className="px-4 py-3 text-right">{fmt(sum((r) => r.qty_received))}</td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right">{fmt(data.documents_qty)}</td>
                    </tr>
                  )}
                  {data.rows.map((r, i) => (
                    <tr key={`${r.doc_type}-${r.doc_id}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {r.doc_type === 'SO' ? 'Sales Order' : 'Transfer Order'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link
                          to={`${isReserved ? DOC_PATH[r.doc_type] : IN_TRANSIT_TO_PATH}/${r.doc_id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {r.doc_number ?? r.doc_id}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.erp_doc_id}</td>
                      <td className="px-4 py-3">
                        {r.status && (
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(r.status)}`}
                          >
                            {r.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.party}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {isReserved ? (
                          <DocRefsCell refs={r.pickings} path={`${OUTBOUND_BASE[r.doc_type]}/picking`} label="Picking ID" context={r.doc_number} />
                        ) : (
                          <DocRefsCell refs={r.sds} path={`${OUTBOUND_BASE[r.doc_type]}/delivery`} label="SD ID" context={r.doc_number} />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        <DocRefsCell refs={r.packings} path={`${OUTBOUND_BASE[r.doc_type]}/packing`} label="Packing ID" context={r.doc_number} />
                      </td>
                      {isReserved && (
                        <>
                          <td className="px-4 py-3 text-right text-slate-700">{fmt(r.qty_picking ?? 0)}</td>
                          {/* Blank until a packing of this picking is closed. */}
                          <td className="px-4 py-3 text-right text-slate-700">
                            {r.qty_packing != null ? fmt(r.qty_packing) : ''}
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${r.packing_diff ? 'font-medium text-rose-600' : 'text-slate-700'}`}
                          >
                            {r.packing_diff ? `−${fmt(r.packing_diff)}` : fmt(0)}
                          </td>
                        </>
                      )}
                      {!isReserved && (
                        <>
                          <td className="px-4 py-3 text-right text-slate-700">{fmt(r.qty_delivered ?? 0)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{fmt(r.qty_received ?? 0)}</td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(r.qty)}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={isReserved ? 12 : 11} className="px-4 py-8 text-center text-slate-400">
                        No SO / TO document holds this quantity.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-700">{label}</dt>
      <dd className="mt-1 text-slate-700">{value ?? ''}</dd>
    </div>
  );
}
