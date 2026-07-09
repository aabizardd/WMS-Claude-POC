import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { AdjustmentApprovalResult, InventoryAdjustmentDetail } from '../../types';
import { adjStatusBadge, adjStatusLabel, adjTypeLabel } from './InventoryAdjustmentsPage';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';

export default function InventoryAdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const canApprove = has('inventory-adjustments:approve');

  const [a, setA] = useState<InventoryAdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalAction, setModalAction] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    api
      .get<InventoryAdjustmentDetail>(`/inventory-adjustments/${id}`)
      .then((r) => setA(r.data))
      .catch(() => setError('Failed to load adjustment.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function openModal(action: 'approve' | 'reject') {
    setModalAction(action);
    setReason('');
  }

  async function submitApproval() {
    if (!modalAction) return;
    if (modalAction === 'reject' && !reason.trim()) {
      toast.error('A reason is required to reject.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.put<AdjustmentApprovalResult>(
        `/inventory-adjustments/${id}/approve`,
        { action: modalAction, reason: reason.trim() || undefined },
      );
      setA(r.data);
      setModalAction(null);
      if (modalAction === 'approve') {
        // Success alert uses the Oracle response message.
        toast.success(r.data.oracle?.message ?? 'Adjustment approved');
      } else {
        toast.success('Adjustment rejected');
      }
    } catch (err) {
      let msg = 'Action failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : m ?? msg;
      }
      // Keep the modal open on failure so the user can retry (esp. Oracle post).
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>;
  }
  if (error || !a) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Adjustment not found.'}
        </div>
        <Link to="/admin/inventory-adjustments" className="btn-secondary">← Back</Link>
      </div>
    );
  }

  const isQty = a.adjustment_type === 'qty_issue';
  // Group items by material for display.
  const groups = new Map<string, typeof a.items>();
  for (const it of a.items) {
    const k = it.material_id ?? it.material_code ?? 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/inventory-adjustments"
            className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">{a.adjustment_number}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {adjTypeLabel(a.adjustment_type)} · {a.warehouse ?? 'No warehouse'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${adjStatusBadge(a.status)}`}>{adjStatusLabel(a.status)}</span>
          {canApprove && a.status === 'PendingApproval' && (
            <>
              <button className="btn-secondary" onClick={() => openModal('reject')}>
                Reject
              </button>
              <button className="btn-primary" onClick={() => openModal('approve')}>
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Adjustment No." value={a.adjustment_number} />
          <Meta label="Type" value={adjTypeLabel(a.adjustment_type)} />
          <Meta label="Warehouse" value={a.warehouse} />
          <Meta
            label="Class"
            value={a.class_name ? `${a.class_name} (${a.class_oracle_id})` : a.class_oracle_id}
          />
          <Meta label="Oracle IA ID" value={a.oracle_id} />
          <Meta label="Status" value={adjStatusLabel(a.status)} />
          <Meta label="Total Qty" value={a.total_qty} />
          <Meta label="Created By" value={a.created_by} />
          <Meta label="Created" value={new Date(a.created_at).toLocaleString()} />
          <Meta label="Note" value={a.note} />
          <Meta label="Oracle Approval Status" value={a.oracle_approval_status} />
        </dl>

        {/* Approval audit trail */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Approval
          </div>
          {a.status === 'PendingApproval' ? (
            <p className="text-sm text-amber-600">Pending Approval WH Manager</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <Meta
                label="Result"
                value={a.status === 'Approved' ? 'Approved by Manager Warehouse' : 'Rejected'}
              />
              <Meta label="By" value={a.approved_by} />
              <Meta
                label="At"
                value={a.approved_at ? new Date(a.approved_at).toLocaleString() : null}
              />
              <Meta label="Reason" value={a.approval_reason} />
            </dl>
          )}
        </div>
      </div>

      {[...groups.entries()].map(([k, items]) => (
        <div key={k} className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-700">
              {items[0].material_code}
              {items[0].material_name ? <span className="ml-2 text-xs font-normal text-slate-400">{items[0].material_name}</span> : null}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Bin</th>
                  <th className="px-5 py-3 text-right">Available (at create)</th>
                  <th className="px-5 py-3 text-right">Qty Issue (at create)</th>
                  <th className="px-5 py-3 text-right">Quality Issue (at create)</th>
                  {isQty ? (
                    <th className="px-5 py-3 text-right">Qty Adjustment</th>
                  ) : (
                    <>
                      <th className="px-5 py-3 text-right">Qty Scrapped</th>
                      <th className="px-5 py-3 text-right">Qty Passed</th>
                    </>
                  )}
                  <th className="px-5 py-3 text-right">New Available (sim.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">{it.bin_label ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{it.avail_at_create}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{it.qty_issue_at_create}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{it.quality_issue_at_create}</td>
                    {isQty ? (
                      <td className="px-5 py-3 text-right font-semibold text-slate-800">{it.qty_adjustment}</td>
                    ) : (
                      <>
                        <td className="px-5 py-3 text-right font-semibold text-slate-800">{it.qty_scrapped}</td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-800">{it.qty_passed}</td>
                      </>
                    )}
                    {(() => {
                      const na = isQty
                        ? it.avail_at_create + it.qty_adjustment
                        : it.avail_at_create - it.qty_scrapped - it.qty_passed;
                      return (
                        <td className={`px-5 py-3 text-right font-semibold ${na < 0 ? 'text-rose-600' : 'text-brand-700'}`}>
                          {na}
                        </td>
                      );
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Discrepancy Documents ({a.discrepancies.length})
        </h3>
        {a.discrepancies.length === 0 ? (
          <p className="text-sm text-slate-400">No discrepancy attached.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {a.discrepancies.map((d) => (
              <a
                key={d.id}
                href={`/admin/discrepancy/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
              >
                {d.discrepancy_id} · {d.type} ↗
              </a>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalAction !== null}
        title={modalAction === 'approve' ? 'Approve adjustment?' : 'Reject adjustment?'}
        onClose={() => (submitting ? null : setModalAction(null))}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {modalAction === 'approve'
              ? 'This will mark the adjustment "Approved by Manager Warehouse" and set Oracle status to "Pending Approval Oracle". This cannot be undone.'
              : 'This will reject the adjustment. This cannot be undone.'}
          </p>
          <div>
            <div className="mb-1 text-xs text-slate-400">
              Reason {modalAction === 'reject' ? '(required)' : '(optional)'}
            </div>
            <textarea
              className="input min-h-[80px] w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason…"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              className="btn-secondary"
              onClick={() => setModalAction(null)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button className="btn-primary" onClick={submitApproval} disabled={submitting}>
              {submitting
                ? 'Saving…'
                : modalAction === 'approve'
                  ? 'Approve'
                  : 'Reject'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
