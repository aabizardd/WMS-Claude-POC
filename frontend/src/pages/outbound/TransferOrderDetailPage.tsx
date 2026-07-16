import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import GeneratePickingModal, {
  type PickAllocation,
} from '../../components/GeneratePickingModal';
import { useAuth } from '../../context/AuthContext';
import type { Pickable, TransferOrderDetail } from '../../types';

// TO statuses that allow generating a picking (remaining = committed-based).
const TO_PICKABLE_STATUSES = [
  'Pending Fulfillment',
  'Pending Receipt/Partially Fulfilled',
  'Partially Fulfilled',
];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-700">{value ?? '—'}</div>
    </div>
  );
}

export default function TransferOrderDetailPage() {
  const { id } = useParams();
  const { has } = useAuth();
  const canGenerate = has('picking:create');

  const [to, setTo] = useState<TransferOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Generate Picking modal state.
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pickable, setPickable] = useState<Pickable | null>(null);
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);

  function loadTo() {
    setLoading(true);
    api
      .get<TransferOrderDetail>(`/transfer-orders/${id}`)
      .then((r) => setTo(r.data))
      .catch(() => setError('Transfer order not found'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<TransferOrderDetail>(`/transfer-orders/${id}`)
      .then((r) => active && setTo(r.data))
      .catch(() => active && setError('Transfer order not found'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function openGenerate() {
    setGenError('');
    setSuccessMsg('');
    setGenOpen(true);
    setGenLoading(true);
    try {
      const [p, pk] = await Promise.all([
        api.get<Pickable>(`/picking/pickable-transfer/${id}`),
        api.get<{ id: number; name: string }[]>('/users/pickers', {
          params: { warehouseId: to?.warehouse?.id ?? undefined },
        }),
      ]);
      setPickable(p.data);
      setPickers(pk.data);
    } catch {
      setGenError('Failed to load picking data.');
    } finally {
      setGenLoading(false);
    }
  }

  async function handleGenerate(allocations: PickAllocation[]) {
    setSubmitting(true);
    try {
      const payload = {
        transferOrderId: id,
        items: allocations.map((a) => ({
          transferOrderItemId: a.itemId,
          requestQty: a.qty,
          binId: a.binId,
          pickerId: a.pickerId,
        })),
      };
      const r = await api.post<{ picking_id: string }>('/picking/generate', payload);
      setGenOpen(false);
      setSuccessMsg(`Picking generated: ${r.data.picking_id}`);
      loadTo();
    } catch (err) {
      let msg = 'Generate failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : m ?? msg;
      }
      throw new Error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  }
  if (error || !to) {
    return (
      <div className="card px-6 py-16 text-center text-slate-400">
        {error || 'Not found'}
      </div>
    );
  }

  const showGenerate =
    canGenerate && TO_PICKABLE_STATUSES.includes(to.status_name ?? '');

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/outbound/transfer-stock/list"
          className="mb-1 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Transfer Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{to.tran_id ?? to.oracle_id}</h1>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
            {to.status_name}
          </span>
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {successMsg}
        </div>
      )}

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Transfer Order Information
          </h3>
          {showGenerate && (
            <button className="btn-primary" onClick={openGenerate}>
              Generate Picking
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="From (source)" value={to.from_location_name} />
          <Field label="To (destination)" value={to.to_location_name} />
          <Field label="Warehouse (WMS)" value={to.warehouse?.name} />
          <Field label="TO Date" value={to.tran_date} />
          <Field
            label="Last modified"
            value={to.last_modified ? new Date(to.last_modified).toLocaleString() : '—'}
          />
          <Field label="Memo" value={to.memo || '—'} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
          Line items ({to.items.length})
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3 text-right">Committed</th>
                <th className="px-5 py-3 text-right">Shipped</th>
                <th className="px-5 py-3 text-right">Fulfilled</th>
                <th className="px-5 py-3 text-right">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {to.items.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-400">{l.line_number}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">
                      {l.item_name ?? l.item_oracle_id ?? '—'}
                    </div>
                    {l.material_name && (
                      <div className="text-xs text-slate-500">
                        {l.material_name}
                        {l.material_code ? ` (${l.material_code})` : ''}
                      </div>
                    )}
                    {l.description && (
                      <div className="text-xs text-slate-400">{l.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.quantity.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.committed.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.shipped.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.fulfilled.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.received.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <GeneratePickingModal
        open={genOpen}
        loading={genLoading}
        submitting={submitting}
        pickable={pickable}
        pickers={pickers}
        loadError={genError}
        remainingHint="remaining (committed)"
        onClose={() => setGenOpen(false)}
        onSubmit={handleGenerate}
      />
    </div>
  );
}
