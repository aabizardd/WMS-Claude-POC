import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { DeliveryDetail, ShipmentResult } from '../../types';

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canShip = has('delivery:update');

  const [dl, setDl] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState('');

  function load() {
    setLoading(true);
    api
      .get<DeliveryDetail>(`/delivery/${id}`)
      .then((r) => setDl(r.data))
      .catch(() => setLoadError('Failed to load Delivery.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runShipment() {
    setShipError('');
    setShipping(true);
    try {
      // Submits an Item Fulfillment to Oracle; SDO ID is filled only on success.
      const r = await api.put<ShipmentResult>(`/delivery/${id}/generate-shipment`, {});
      const f = r.data.fulfillment;
      toast.success(
        `${f?.message ?? 'Shipment generated'}${f?.fulfillment_id ? ` (Fulfillment #${f.fulfillment_id})` : ''} — SDO ${r.data.sdo_id}`,
      );
      setDl(r.data);
    } catch (err) {
      let msg = 'Generate failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : m ?? msg;
      }
      setShipError(msg);
      toast.error(msg);
    } finally {
      setShipping(false);
    }
  }

  async function handleGenerateShipment() {
    const ok = await confirm({
      title: 'Generate Shipment?',
      description:
        'An Item Fulfillment will be submitted to Oracle. On success an SDO ID is generated and the delivery is Closed (moved to History). This cannot be undone.',
      type: 'info',
      confirmText: 'Generate Shipment',
    });
    if (!ok) return;
    await runShipment();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (loadError || !dl) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Delivery not found.'}
        </div>
        <Link to="/admin/outbound/sales-order/delivery" className="btn-secondary">
          ← Back to Delivery
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Blocking loading overlay while hitting the Oracle fulfillment API */}
      {shipping && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-8 py-6 shadow-xl">
            <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div className="text-sm font-medium text-slate-700">
              Submitting Item Fulfillment to Oracle…
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to={`${dl.source_type === 'TRANSFER_ORDER' ? '/admin/outbound/transfer-stock' : '/admin/outbound/sales-order'}/delivery`}
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
              {dl.customer ?? '—'} · {dl.location ?? 'No location'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`badge ${
              dl.status === 'Closed'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {dl.status}
          </span>
          {canShip && dl.status !== 'Closed' && (
            <button
              className="btn-primary"
              onClick={handleGenerateShipment}
              disabled={shipping}
            >
              {shipping ? 'Generating…' : 'Generate Shipment'}
            </button>
          )}
        </div>
      </div>

      {/* Fulfillment failure — allow retry */}
      {shipError && dl.status !== 'Closed' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div>
            <span className="font-semibold">Shipment failed:</span> {shipError}
          </div>
          {canShip && (
            <button className="btn-primary" onClick={runShipment} disabled={shipping}>
              {shipping ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      )}

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery Document
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Delivery ID" value={dl.delivery_id} />
          <Meta label="SDO ID" value={dl.sdo_id} />
          <Meta label="Packing ID" value={dl.packing_id} />
          {dl.source_type === 'TRANSFER_ORDER' ? (
            <>
              <Meta
                label="TO Number"
                value={
                  dl.to_id ? (
                    <Link to={`/admin/outbound/transfer-stock/list/${dl.to_id}`} className="text-brand-700 hover:underline">
                      {dl.to_number ?? '—'}
                    </Link>
                  ) : (
                    dl.to_number
                  )
                }
              />
              <Meta label="Transfer Order (Oracle ID)" value={dl.to_oracle_id} />
            </>
          ) : (
            <>
              <Meta
                label="SO Number"
                value={
                  dl.so_id ? (
                    <Link to={`/admin/outbound/sales-order/list/${dl.so_id}`} className="text-brand-700 hover:underline">
                      {dl.so_number ?? '—'}
                    </Link>
                  ) : (
                    dl.so_number
                  )
                }
              />
              <Meta label="Sales Order (Oracle ID)" value={dl.so_oracle_id} />
            </>
          )}
          <Meta label="Location" value={dl.location} />
          <Meta
            label={dl.source_type === 'TRANSFER_ORDER' ? 'Warehouse Destination' : 'Customer'}
            value={dl.customer}
          />
          <Meta label="Status" value={dl.status} />
        </dl>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Material Detail
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
