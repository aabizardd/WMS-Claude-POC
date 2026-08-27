import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  AdjustmentOracleCheckResult,
  InventoryAdjustmentDetail,
} from '../../types';
import { adjStatusBadge, adjStatusLabel } from './InventoryAdjustmentsPage';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';
import Collapsible from '../../components/Collapsible';

type PendingAction = 'approve' | 'reject' | 'send' | null;

function errMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const m = err.response?.data?.message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  return fallback;
}

export default function InventoryAdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();

  const canApprove = has('inventory-adjustments:approve');

  const [a, setA] = useState<InventoryAdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  // Which material is on screen in the inventory slider.
  const [slide, setSlide] = useState(0);
  const [logsOpen, setLogsOpen] = useState(false);

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

  function open(action: Exclude<PendingAction, null>) {
    setPending(action);
    setReason('');
  }

  // FR-IA-12 rule 6: the confirm button locks while the request is in flight.
  async function runPending() {
    if (!pending || busy) return;
    if (pending === 'reject' && !reason.trim()) {
      toast.error('A reason is required to reject.');
      return;
    }
    setBusy(true);
    try {
      const url =
        pending === 'send'
          ? `/inventory-adjustments/${id}/send-oracle`
          : `/inventory-adjustments/${id}/approve`;
      const body =
        pending === 'approve' || pending === 'reject'
          ? { action: pending, reason: reason.trim() || undefined }
          : {};

      const r = await api.put<InventoryAdjustmentDetail>(url, body);
      setA(r.data);
      setPending(null);

      if (pending === 'reject') toast.success('Adjustment rejected');
      else if (r.data.oracle_error) toast.error(`Oracle: ${r.data.oracle_error}`);
      else if (r.data.status === 'Completed') toast.success('Approved and stock updated');
      else toast.success('Approved and sent to Oracle');
    } catch (err) {
      // Keep the dialog open so the action can be retried.
      toast.error(errMessage(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  }

  /** FR-IA-13: read the Oracle decision and settle the document. */
  async function checkOracle() {
    if (checking) return;
    setChecking(true);
    try {
      const r = await api.put<AdjustmentOracleCheckResult>(
        `/inventory-adjustments/${id}/check-oracle`,
        {},
      );
      setA(r.data);
      const c = r.data.oracle_check;
      if (!c) toast.success('Status refreshed');
      else if (r.data.status === 'Completed') toast.success(c.message);
      else if (r.data.status === 'RejectedByOracle') toast.error(c.message);
      else toast.info(c.message);
    } catch (err) {
      toast.error(errMessage(err, 'Could not read the Oracle status'));
    } finally {
      setChecking(false);
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
        <Link to="/admin/inventory-adjustments" className="btn-secondary">
          ← Back
        </Link>
      </div>
    );
  }

  const isQuality = a.qty_mode === 'passed_non_passed';
  const isAuto = a.qty_mode === 'auto_negative';

  // Group items by material — one material per slide.
  const groups = new Map<string, typeof a.items>();
  for (const it of a.items) {
    const k = it.material_id ?? it.material_code ?? 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const groupList = [...groups.entries()];
  // Clamp rather than reset, so the index stays valid if the document reloads.
  const current = Math.min(slide, Math.max(groupList.length - 1, 0));
  const hasSlider = groupList.length > 1;
  const go = (i: number) => setSlide((i + groupList.length) % groupList.length);

  const dialogCopy: Record<Exclude<PendingAction, null>, { title: string; body: string; cta: string }> = {
    approve: {
      title: 'Approve adjustment?',
      body: a.oracle_error
        ? 'This document already has a failed Oracle send. Use "Resend to Oracle" instead.'
        : 'Approving records the internal decision. The document is then sent to Oracle (unless it has no Qty Passed), and stock changes only once Oracle approves.',
      cta: 'Approve',
    },
    reject: {
      title: 'Reject adjustment?',
      body: 'The document becomes final. A rejected document cannot be resubmitted — a correction needs a new document.',
      cta: 'Reject',
    },
    send: {
      title: 'Resend to Oracle?',
      body: 'The previous send failed and no stock was changed. Resending reuses the same document, so Oracle will not receive a duplicate adjustment.',
      cta: 'Resend',
    },
  };

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
              {a.adjustment_type_label} · {a.warehouse ?? 'No warehouse'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`badge ${adjStatusBadge(a.status)}`}>{adjStatusLabel(a.status)}</span>

          {a.status === 'WaitingApproval' && canApprove && (
            <>
              <button className="btn-secondary" onClick={() => open('reject')}>
                Reject
              </button>
              <button className="btn-primary" onClick={() => open('approve')}>
                Approve
              </button>
            </>
          )}

          {/* FR-IA-16 rule 3: an approved document whose Oracle send failed. */}
          {a.status === 'Approved' && a.oracle_error && canApprove && (
            <button className="btn-primary" onClick={() => open('send')}>
              Resend to Oracle
            </button>
          )}

          {a.status === 'WaitingOracleApproval' && (
            <button className="btn-primary" onClick={checkOracle} disabled={checking}>
              {checking ? 'Checking…' : 'Check Oracle Status'}
            </button>
          )}
        </div>
      </div>

      {/* FR-IA-16 rule 2: the failure is visible with its cause. */}
      {a.oracle_error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <b>Oracle send failed.</b> No stock was changed. {a.oracle_error}
        </div>
      )}
      {a.status === 'RejectedByOracle' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <b>Rejected by Oracle.</b> No stock was changed. This document is final — create a new one to correct
          it. {a.oracle_reject_reason ?? ''}
        </div>
      )}

      <div className="card p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Adjustment No." value={a.adjustment_number} />
          <Meta label="IA Type" value={a.adjustment_type_label} />
          <Meta label="Warehouse" value={a.warehouse} />
          <Meta
            label="Class"
            value={a.class_name ? `${a.class_name} (${a.class_oracle_id})` : a.class_oracle_id}
          />
          <Meta label="Status" value={adjStatusLabel(a.status)} />
          <Meta label="Total Qty" value={a.total_qty} />
          <Meta label="Memo" value={a.memo} />
          <Meta
            label="Memo sent to Oracle"
            value={<span className="font-mono text-xs">{a.oracle_memo}</span>}
          />
          <Meta label="Oracle IA ID" value={a.oracle_id} />
          <Meta label="Oracle Approval Status" value={a.oracle_approval_status} />
          <Meta
            label="Sent to Oracle"
            value={a.oracle_sent_at ? new Date(a.oracle_sent_at).toLocaleString() : null}
          />
          <Meta
            label="Completed"
            value={a.completed_at ? new Date(a.completed_at).toLocaleString() : null}
          />
        </dl>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stage
            title="Created & Submitted"
            who={a.created_by}
            when={a.created_at}
            note={null}
            done
          />
          <Stage
            title={a.status === 'Rejected' ? 'Rejected' : 'Approved'}
            who={a.approved_by}
            when={a.approved_at}
            note={a.approval_reason}
            done={!!a.approved_at}
          />
        </div>
      </div>

      {/* Inventory information — one material per slide so the page stays short. */}
      {groupList.length > 0 && (() => {
        const [k, items] = groupList[current];
        return (
          <div key={k} className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <h3 className="min-w-0 text-sm font-semibold text-slate-700">
                {items[0].material_code}
                {items[0].material_name ? (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {items[0].material_name}
                  </span>
                ) : null}
              </h3>

              {hasSlider && (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-400">
                    Material {current + 1} of {groupList.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Previous material"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    onClick={() => go(current - 1)}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Next material"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    onClick={() => go(current + 1)}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Bin</th>
                    <th className="px-5 py-3 text-right">Available (at create)</th>
                    <th className="px-5 py-3 text-right">Qty Issue (at create)</th>
                    <th className="px-5 py-3 text-right">Quality Issue (at create)</th>
                    {isQuality ? (
                      <>
                        <th className="px-5 py-3 text-right">Qty Passed</th>
                        <th className="px-5 py-3 text-right">Qty Non-Passed</th>
                      </>
                    ) : (
                      <th className="px-5 py-3 text-right">Qty Adjustment</th>
                    )}
                    <th className="px-5 py-3 text-right">Effect on WMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{it.bin_label ?? '—'}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{it.avail_at_create}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{it.qty_issue_at_create}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{it.quality_issue_at_create}</td>
                      {isQuality ? (
                        <>
                          <td className="px-5 py-3 text-right font-semibold text-slate-800">{it.qty_passed}</td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-800">
                            {it.qty_non_passed}
                          </td>
                        </>
                      ) : (
                        <td className="px-5 py-3 text-right font-semibold text-slate-800">
                          {it.qty_adjustment}
                        </td>
                      )}
                      <td className="px-5 py-3 text-right text-xs text-slate-500">
                        {isAuto ? (
                          a.adjustment_type === 'DiscrepancyQuantity' ? (
                            <>Qty Issue → 0</>
                          ) : (
                            <>Oracle only</>
                          )
                        ) : isQuality ? (
                          <>
                            Available +{it.qty_passed}
                            <br />
                            Quality Issue −{it.qty_passed + it.qty_non_passed}
                          </>
                        ) : (
                          <>
                            Available {it.qty_adjustment >= 0 ? '+' : ''}
                            {it.qty_adjustment}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasSlider && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 px-5 py-3">
                {groupList.map(([gk, gItems], i) => (
                  <button
                    key={gk}
                    type="button"
                    title={gItems[0].material_code ?? undefined}
                    aria-label={`Go to material ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === current ? 'w-5 bg-brand-600' : 'w-1.5 bg-slate-300 hover:bg-slate-400'
                    }`}
                    onClick={() => setSlide(i)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {a.discrepancies.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Discrepancy References ({a.discrepancies.length})
          </h3>
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
        </div>
      )}

      {/* FR-IA-13 rule 8 / FR-IA-16 rule 6: raw Oracle traffic for reconciliation. */}
      {a.integration_logs.length > 0 && (
        <Collapsible
          title="Oracle Integration Log"
          subtitle={`${a.integration_logs.length} call(s)`}
          open={logsOpen}
          onToggle={() => setLogsOpen((v) => !v)}
        >
          <div className="space-y-3 px-4 pb-4">
            {a.integration_logs.map((l) => (
              <div key={l.id} className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs">
                  <span
                    className={`badge ${l.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
                  >
                    {l.ok ? 'OK' : 'FAILED'}
                  </span>
                  <span className="font-medium text-slate-700">
                    {l.operation === 'post' ? 'Send adjustment' : 'Check status'}
                  </span>
                  <span className="font-mono text-slate-400">{l.endpoint}</span>
                  {l.http_status != null && (
                    <span className="text-slate-400">HTTP {l.http_status}</span>
                  )}
                  {l.duration_ms != null && (
                    <span className="text-slate-400">{l.duration_ms} ms</span>
                  )}
                  <span className="ml-auto text-slate-400">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </div>
                {l.error && (
                  <div className="border-b border-slate-100 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                    {l.error}
                  </div>
                )}
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs text-slate-400">Request</div>
                    <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                      {JSON.stringify(l.request, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-400">Response</div>
                    <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                      {l.response == null ? '—' : JSON.stringify(l.response, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {/* FR-IA-15: audit trail */}
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Document History
        </h3>
        {a.events.length === 0 ? (
          <p className="text-sm text-slate-400">No activity recorded.</p>
        ) : (
          <ol className="space-y-3">
            {a.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                <div className="min-w-0">
                  <div className="font-medium text-slate-700">
                    {e.action.replace(/_/g, ' ')}
                    {e.from_status && e.to_status && e.from_status !== e.to_status && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {adjStatusLabel(e.from_status)} → {adjStatusLabel(e.to_status)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    {e.actor ?? 'System'} · {new Date(e.created_at).toLocaleString()}
                  </div>
                  {e.message && <div className="mt-0.5 text-xs text-slate-500">{e.message}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Modal
        open={pending !== null}
        title={pending ? dialogCopy[pending].title : ''}
        onClose={() => (busy ? null : setPending(null))}
      >
        {pending && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">{dialogCopy[pending].body}</p>
            {(pending === 'approve' || pending === 'reject') && (
              <div>
                <div className="mb-1 text-xs text-slate-400">
                  Reason {pending === 'reject' ? '(required)' : '(optional)'}
                </div>
                <textarea
                  className="input min-h-[80px] w-full"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason…"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={runPending} disabled={busy}>
                {busy ? 'Working…' : dialogCopy[pending].cta}
              </button>
            </div>
          </div>
        )}
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

function Stage({
  title,
  who,
  when,
  note,
  done,
}: {
  title: string;
  who: string | null;
  when: string | null;
  note: string | null;
  done: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        done ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-200'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {done ? (
        <>
          <div className="mt-1 text-sm font-medium text-slate-700">{who ?? '—'}</div>
          <div className="text-xs text-slate-400">{when ? new Date(when).toLocaleString() : '—'}</div>
          {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
        </>
      ) : (
        <div className="mt-1 text-sm text-slate-300">Pending</div>
      )}
    </div>
  );
}
