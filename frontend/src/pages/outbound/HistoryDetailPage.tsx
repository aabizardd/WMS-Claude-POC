import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import type { DeliveryDetail } from '../../types';

export default function HistoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dl, setDl] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<DeliveryDetail>(`/delivery/${id}`)
      .then((r) => active && setDl(r.data))
      .catch(() => active && setLoadError('Failed to load history.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (loadError || !dl) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'History not found.'}
        </div>
        <Link to="/admin/outbound/sales-order/history" className="btn-secondary">
          ← Back to History
        </Link>
      </div>
    );
  }

  const t = dl.tracking;
  // The whole page (back link + tracking chain) stays within the tab the
  // delivery came from: Transfer Stock for a TO, Sales Order otherwise.
  const isTransfer = dl.source_type === 'TRANSFER_ORDER';
  const base = isTransfer
    ? '/admin/outbound/transfer-stock'
    : '/admin/outbound/sales-order';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to={`${base}/history`}
            className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="page-title">{dl.delivery_id}</h1>
            <p className="page-subtitle">
              {dl.sdo_id ?? '—'} · {dl.customer ?? '—'}
            </p>
          </div>
        </div>
        <span className="badge bg-emerald-50 text-emerald-700">{dl.status}</span>
      </div>

      {/* Tracking chain: Sales Order / Transfer Order → Picking → Packing → Delivery */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Tracking
        </h3>
        <div className="flex flex-wrap items-stretch gap-2">
          {isTransfer ? (
            <Track
              label="Transfer Order"
              value={t.to_number}
              to={t.to_id ? `${base}/list/${t.to_id}` : undefined}
              sub={t.customer}
            />
          ) : (
            <Track
              label="Sales Order"
              value={t.so_number}
              to={t.so_id ? `${base}/list/${t.so_id}` : undefined}
              sub={t.customer}
            />
          )}
          <Arrow />
          <Track
            label="Picking"
            value={t.picking_code}
            to={t.picking_id ? `${base}/picking/${t.picking_id}` : undefined}
            sub={t.picking_status === 'OnProgress' ? 'On Progress' : t.picking_status}
          />
          <Arrow />
          <Track
            label="Packing"
            value={t.packing_code}
            to={t.packing_id ? `${base}/packing/${t.packing_id}` : undefined}
          />
          <Arrow />
          <Track label="Delivery" value={t.delivery_code} sub={t.sdo_id ?? undefined} highlight />
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery Information
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Delivery ID" value={dl.delivery_id} />
          <Meta label="SDO ID" value={dl.sdo_id} />
          <Meta label="Packing ID" value={dl.packing_id} />
          {dl.source_type === 'TRANSFER_ORDER' ? (
            <>
              <Meta label="TO Number" value={dl.to_number} />
              <Meta label="Transfer Order (Oracle ID)" value={dl.to_oracle_id} />
            </>
          ) : (
            <>
              <Meta label="SO Number" value={dl.so_number} />
              <Meta label="Sales Order (Oracle ID)" value={dl.so_oracle_id} />
            </>
          )}
          <Meta
            label={dl.source_type === 'TRANSFER_ORDER' ? 'Warehouse Destination' : 'Customer'}
            value={dl.customer}
          />
          <Meta label="Location" value={dl.location} />
          <Meta label="Status" value={dl.status} />
          <Meta label="Created" value={new Date(dl.created_at).toLocaleString()} />
        </dl>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Delivery Items
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-5 py-3 text-right">Line #</th>
                <th className="px-5 py-3">Material Code</th>
                <th className="px-5 py-3">Material Name</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3">UOM</th>
                <th className="px-5 py-3">Bin</th>
                <th className="px-5 py-3">Picker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dl.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    No items.
                  </td>
                </tr>
              ) : (
                dl.items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-right text-slate-600">
                      {it.line_number ?? '—'}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {it.material_code ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{it.material_name ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{it.qty}</td>
                    <td className="px-5 py-3 text-slate-600">{it.uom ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{it.bin_label ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{it.picker?.name ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Track({
  label,
  value,
  sub,
  to,
  highlight,
}: {
  label: string;
  value: string | null;
  sub?: string | null;
  to?: string;
  highlight?: boolean;
}) {
  const inner = (
    <div
      className={`min-w-[9rem] rounded-xl border p-3 ${
        highlight ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800">{value ?? '—'}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="transition hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function Arrow() {
  return (
    <div className="flex items-center text-slate-300">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">
        {value || <span className="text-slate-300">—</span>}
      </dd>
    </div>
  );
}
