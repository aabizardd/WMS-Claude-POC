import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { GenerateGrFromPoResult, PurchaseOrderDetail } from '../../types';

// PO statuses that allow generating a Goods Receive.
const RECEIVABLE_PO_STATUSES = ['pendingReceipt', 'pendingBillPartReceived'];

interface GrItemForm {
  selected: boolean;
  qty: number;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-700">{value ?? '—'}</div>
    </div>
  );
}

export default function PoDetailPage() {
  const { id } = useParams();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canGenerate = has('goods-receive:create');
  const canSync = has('purchase-orders:sync');
  const [refreshing, setRefreshing] = useState(false);

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Generate GR modal state.
  const [grOpen, setGrOpen] = useState(false);
  const [grError, setGrError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [forms, setForms] = useState<Record<string, GrItemForm>>({});

  function load() {
    setLoading(true);
    api
      .get<PurchaseOrderDetail>(`/purchase-orders/${id}`)
      .then((r) => setPo(r.data))
      .catch(() => setError('Purchase order not found'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-pull this PO (header + lines) from Oracle — receipts change line
  // quantities without bumping lastmodified, so incremental sync misses them.
  async function handleRefresh() {
    if (!po) return;
    setRefreshing(true);
    try {
      await api.post(`/purchase-orders/${po.oracle_id}/refresh`);
      toast.success('PO refreshed from ERP');
      load();
    } catch {
      toast.error('Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  // Only lines still outstanding (and with a line number) can be received.
  const receivableLines = (po?.lines ?? []).filter(
    (l) => l.line_number != null && l.qty_remaining_to_receive > 0,
  );

  function openGenerate() {
    setGrError('');
    setSuccessMsg('');
    setForms(
      Object.fromEntries(
        receivableLines.map((l) => [
          l.id,
          { selected: false, qty: l.qty_remaining_to_receive } as GrItemForm,
        ]),
      ),
    );
    setGrOpen(true);
  }

  function patchForm(lineId: string, p: Partial<GrItemForm>) {
    setForms((f) => ({ ...f, [lineId]: { ...f[lineId], ...p } }));
  }

  async function handleGenerate() {
    if (!po) return;
    setGrError('');
    const chosen = receivableLines.filter((l) => forms[l.id]?.selected);
    if (chosen.length === 0) {
      setGrError('Select at least one item.');
      return;
    }
    for (const l of chosen) {
      const qty = Number(forms[l.id].qty);
      if (!(qty > 0)) {
        setGrError(`Actual qty must be greater than 0 for "${l.item_display ?? l.line_id}".`);
        return;
      }
      if (qty > l.qty_remaining_to_receive + 1e-9) {
        setGrError(
          `Actual qty (${qty}) exceeds outstanding (${l.qty_remaining_to_receive}) for "${l.item_display ?? l.line_id}".`,
        );
        return;
      }
    }
    const ok = await confirm({
      title: 'Generate Goods Receive?',
      description:
        'An Item Receipt will be submitted to Oracle for the selected items. This cannot be undone.',
      type: 'info',
      confirmText: 'Generate GR',
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const r = await api.post<GenerateGrFromPoResult>('/goods-receive/generate-from-po', {
        purchaseOrderId: po.id,
        items: chosen.map((l) => ({ lineId: l.id, qtyActual: Number(forms[l.id].qty) })),
      });
      setGrOpen(false);
      setSuccessMsg(`Goods Receive generated: ${r.data.gr_number}`);
      toast.success(`Goods Receive generated: ${r.data.gr_number}`);
      load();
    } catch (err) {
      let msg = 'Generate failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : m ?? msg;
      }
      setGrError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  }
  if (error || !po) {
    return (
      <div className="card px-6 py-16 text-center text-slate-400">
        {error || 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/inbound/local/po"
          className="mb-1 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Purchase Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title">{po.po_number ?? po.oracle_id}</h1>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              {po.po_status_label ?? po.po_status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canSync && (
              <button className="btn-secondary" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh from ERP'}
              </button>
            )}
            {canGenerate &&
              RECEIVABLE_PO_STATUSES.includes(po.po_status ?? '') &&
              receivableLines.length > 0 && (
                <button className="btn-primary" onClick={openGenerate}>
                  Generate GR
                </button>
              )}
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {successMsg}
        </div>
      )}

      <div className="card p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Oracle ID" value={po.oracle_id} />
          <Field label="Vendor" value={po.vendor_name} />
          <Field label="PO Date" value={po.po_date} />
          <Field label="Warehouse" value={po.warehouse?.name} />
          <Field label="Location" value={po.location_name} />
          <Field label="Subsidiary" value={po.subsidiary_display} />
          <Field label="Department" value={po.department_display} />
          <Field label="Class" value={po.class_display} />
          <Field label="Currency" value={po.currency_symbol} />
          <Field label="Approval" value={po.approval_status_display} />
          <Field label="Created by" value={po.created_by_netsuite} />
          <Field
            label="Last modified"
            value={po.last_modified ? new Date(po.last_modified).toLocaleString() : '—'}
          />
          <Field label="Memo" value={po.memo || '—'} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
          Line items ({po.lines.length})
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Line #</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3 text-right">Received</th>
                <th className="px-5 py-3 text-right">Remaining</th>
                <th className="px-5 py-3">Inbound Shipment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.lines.map((l, i) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-5 py-3 text-slate-600">{l.line_number ?? '—'}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">
                      {l.item_display ?? l.item_oracle_id ?? '—'}
                    </div>
                    {l.description && (
                      <div className="text-xs text-slate-400">{l.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.quantity.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.quantity_received.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">
                    {l.qty_remaining_to_receive.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {l.inbound_shipment_number ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={grOpen}
        title="Generate Goods Receive"
        maxWidthClass="max-w-2xl"
        onClose={() => (submitting ? null : setGrOpen(false))}
      >
        <div className="space-y-4">
          {grError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {grError}
            </div>
          )}
          <p className="text-sm text-slate-500">
            Select the items received and enter the actual quantity. An Item Receipt is
            submitted to Oracle; qty cannot exceed the outstanding (PO qty − received).
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {receivableLines.map((l) => {
              const f = forms[l.id];
              if (!f) return null;
              return (
                <div key={l.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={f.selected}
                      onChange={(e) => patchForm(l.id, { selected: e.target.checked })}
                    />
                    <span className="text-xs text-slate-400">Line {l.line_number}</span>
                    {l.item_display ?? '—'}
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-4 pl-6 text-xs text-slate-500">
                    <span>PO Qty: {l.quantity.toLocaleString()}</span>
                    <span>Received: {l.quantity_received.toLocaleString()}</span>
                    <span className="font-medium text-slate-700">
                      Outstanding: {l.qty_remaining_to_receive.toLocaleString()}
                    </span>
                  </div>
                  {f.selected && (
                    <div className="mt-2 pl-6">
                      <label className="block text-xs text-slate-400">Actual Qty Receive</label>
                      <input
                        type="number"
                        step="any"
                        min={0}
                        max={l.qty_remaining_to_receive}
                        className="input mt-0.5 w-40 text-right text-sm"
                        value={f.qty}
                        onChange={(e) => patchForm(l.id, { qty: Number(e.target.value) })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setGrOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={submitting || receivableLines.length === 0}
            >
              {submitting ? 'Submitting to Oracle…' : 'Generate GR'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
