import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { SalesDeliveryDetail } from '../../types';
import { useToast } from '../../context/ToastContext';
import TablePager from '../../components/TablePager';
import ToolbarMenu, { ExportIcon, PrintIcon } from '../../components/ToolbarMenu';
import { RefreshButton } from '../../components/ListView';
import { formatDateTime } from '../outbound/deliveryColumns';
import { sdStatusLabel } from './SalesDeliveryListPage';

const fmt = (n: number) => n.toLocaleString();

/** Outlined status pill, as on the other detail pages. */
function statusPill(status: string) {
  const cls =
    status === 'Failed'
      ? 'border-rose-300 bg-rose-50 text-rose-700'
      : 'border-emerald-300 bg-emerald-50 text-emerald-700';
  return (
    <span className={`inline-flex min-w-[7rem] justify-center rounded-full border px-3 py-0.5 text-xs font-medium ${cls}`}>
      {sdStatusLabel(status)}
    </span>
  );
}

/**
 * Detail of one Sales Delivery or Sales Return, laid out like WMS dev's
 * "Detail Sales Delivery": the header fields in two columns, the memo, then the
 * Materials & Bins list.
 */
export default function SalesDeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [d, setD] = useState<SalesDeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<SalesDeliveryDetail>(`/sales-delivery/${id}`)
      .then((r) => {
        setD(r.data);
        setError('');
      })
      .catch((err) => {
        const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
        setError(typeof m === 'string' ? m : 'Sales delivery not found.');
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !d) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>;
  }
  if (error || !d) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Sales delivery not found.'}
        </div>
        <Link to="/admin/inventory/sales-delivery" className="btn-secondary">
          ← Back
        </Link>
      </div>
    );
  }

  const isReturn = d.document_type === 'SalesReturn';
  const items = d.items;
  const paged = items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/admin/inventory/sales-delivery${isReturn ? '?type=return' : ''}`}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">
            Detail {isReturn ? 'Sales Return' : 'Sales Delivery'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarMenu
            items={[
              {
                label: 'Print',
                icon: <PrintIcon />,
                onClick: () => navigate(`/admin/inventory/sales-delivery/${d.id}/print`),
              },
              {
                label: 'Export',
                icon: <ExportIcon />,
                onClick: () => toast.info('Export is not available yet.'),
              },
            ]}
          />
          <RefreshButton onClick={load} spinning={loading} />
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
          <Info label="Status" value={statusPill(d.status)} />
          <Info label={isReturn ? 'SR Number' : 'SD Number'} value={d.delivery_number} />
          {isReturn && (
            <Info
              label="Source SD Number"
              value={
                d.source_delivery_id ? (
                  <Link
                    to={`/admin/inventory/sales-delivery/${d.source_delivery_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {d.source_delivery_number}
                  </Link>
                ) : null
              }
            />
          )}
          <Info label="Origin Location" value={d.from_warehouse} />
          <Info label="Destination Location" value={d.to_warehouse} />
          <Info label="Department" value={d.department_name} />
          <Info label="Class" value={d.class_name} />
          <Info label="Customer" value={d.customer_name} />
          <Info
            label="Total Quantity"
            value={<span className="font-semibold text-brand-700">{fmt(d.total_qty)}</span>}
          />
          {/* A generated dummy: the POC does not post to NetSuite. */}
          <Info label="Netsuite ID" value={d.netsuite_id} />
          <Info label="Created By" value={d.created_by} />
          <Info label="Created At (WIB)" value={formatDateTime(d.created_at)} />
        </dl>

        <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
          <div className="text-xs font-semibold text-slate-700">Memo</div>
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-700">
            {d.memo || '-'}
          </div>
        </div>
      </div>

      {/* Materials & Bins */}
      <div className="mt-6 border-b border-slate-200">
        <span className="-mb-px inline-flex items-center gap-2 border-b-2 border-brand-600 px-1 pb-2.5 text-sm font-semibold text-brand-700">
          Materials &amp; Bins
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {items.length}
          </span>
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                <th>No</th>
                <th>Material</th>
                <th>Bin</th>
                <th className="text-right">Available QTY</th>
                <th className="text-right">{isReturn ? 'Qty Returned' : 'Qty Delivered'}</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paged.map((it, i) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{it.material_code ?? '-'}</div>
                    {it.material_name && <div className="text-xs text-slate-500">{it.material_name}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{it.bin_code ?? it.bin_label ?? '-'}</div>
                    {it.bin_code && it.bin_label && (
                      <div className="text-xs text-slate-500">{it.bin_label}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{fmt(it.avail_at_create)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-700">
                    {fmt(it.qty_transfer)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{it.remarks}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    This document has no materials.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager
          page={page}
          pageSize={pageSize}
          total={items.length}
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

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-700">{label}</dt>
      <dd className="mt-1 text-slate-700">
        {value === null || value === undefined || value === '' ? '-' : value}
      </dd>
    </div>
  );
}
