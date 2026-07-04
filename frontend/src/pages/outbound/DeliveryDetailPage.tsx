import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { DeliveryDetail } from '../../types';

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

  async function handleGenerateShipment() {
    const ok = await confirm({
      title: 'Generate Shipment?',
      description:
        'An SDO ID will be generated and the delivery will be Closed (moved to History). This cannot be undone.',
      type: 'info',
      confirmText: 'Generate Shipment',
    });
    if (!ok) return;
    setShipping(true);
    try {
      const r = await api.put<DeliveryDetail>(`/delivery/${id}/generate-shipment`, {});
      toast.success(`Shipment generated: ${r.data.sdo_id}`);
      setDl(r.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Generate failed');
      } else toast.error('Generate failed');
    } finally {
      setShipping(false);
    }
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
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/outbound/sales-order/delivery"
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

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery Document
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Delivery ID" value={dl.delivery_id} />
          <Meta label="SDO ID" value={dl.sdo_id} />
          <Meta label="Packing ID" value={dl.packing_id} />
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
          <Meta label="Location" value={dl.location} />
          <Meta label="Customer" value={dl.customer} />
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
                <th className="px-5 py-3">Material Code</th>
                <th className="px-5 py-3">Material Name</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3">Bin</th>
                <th className="px-5 py-3">Picker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dl.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    No items.
                  </td>
                </tr>
              ) : (
                dl.items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {it.material_code ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{it.material_name ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{it.qty}</td>
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
