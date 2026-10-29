import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { AdjustmentOracleCheckResult, InventoryAdjustmentDetail } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { DetailCard, InfoGrid, PrimaryButton } from '../../components/wms/DocKit';
import { AdjLinesTable, AdjStatusPill, SignedQty, adjTypeLabel } from './iaShared';

type PendingAction = 'approve' | 'reject' | 'send' | null;
type Tab = 'bins' | 'history' | 'discrepancies' | 'oracle';

function errMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const m = err.response?.data?.message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  return fallback;
}

/** "2026-10-27 10:45" — WMS dev shows minutes, labelled WIB. */
function fmtWib(v: string | null | undefined) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The audit trail's actions, worded the way WMS dev's History tab words them. */
const EVENT_LABELS: Record<string, string> = {
  created: 'Submitted for approval',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  oracle_sent: 'Sent to Oracle',
  oracle_failed: 'Oracle send failed',
  oracle_approved: 'Approved by Oracle',
  oracle_rejected: 'Rejected by Oracle',
  completed: 'Completed — stock updated',
  stock_failed: 'Stock update failed',
  updated: 'Updated',
};
const eventLabel = (a: string) => EVENT_LABELS[a] ?? a.replace(/_/g, ' ');

export default function InventoryAdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const canApprove = has('inventory-adjustments:approve');

  const [a, setA] = useState<InventoryAdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('bins');

  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(
    (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      api
        .get<InventoryAdjustmentDetail>(`/inventory-adjustments/${id}`)
        .then((r) => {
          setA(r.data);
          setError('');
        })
        .catch(() => setError('Failed to load adjustment.'))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [id],
  );
  useEffect(() => load(), [load]);

  function openDialog(action: Exclude<PendingAction, null>) {
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
      const url = pending === 'send' ? `/inventory-adjustments/${id}/send-oracle` : `/inventory-adjustments/${id}/approve`;
      const body = pending === 'send' ? {} : { action: pending, reason: reason.trim() || undefined };
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
      const r = await api.put<AdjustmentOracleCheckResult>(`/inventory-adjustments/${id}/check-oracle`, {});
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || 'Adjustment not found.'}</div>
        <Link to="/admin/inventory-adjustments" className="btn-secondary">
          ← Back
        </Link>
      </div>
    );
  }

  const isQuality = a.qty_mode === 'passed_non_passed';
  const decided = a.approved_by && a.status !== 'WaitingApproval';

  const fields: { label: string; value: ReactNode }[] = [
    { label: 'Status', value: <AdjStatusPill status={a.status} compact /> },
    { label: 'Adjustment Code', value: a.adjustment_number },
    { label: 'Type', value: adjTypeLabel(a.adjustment_type) },
    { label: 'Total Adjustment', value: <SignedQty value={a.total_qty} className="font-semibold" /> },
    { label: 'ERP Doc ID', value: a.oracle_id && a.oracle_id !== '-' ? a.oracle_id : '-' },
    { label: 'Class', value: a.class_name },
    { label: 'Department', value: a.department_name },
    { label: 'Warehouse', value: a.warehouse },
    { label: 'Ownership', value: a.ownership },
    { label: 'Created By', value: a.created_by },
    { label: 'Created At (WIB)', value: fmtWib(a.created_at) },
  ];
  if (decided) {
    const rejected = a.status === 'Rejected';
    fields.push(
      { label: rejected ? 'Rejected By' : 'Approved By', value: a.approved_by },
      { label: rejected ? 'Rejected At (WIB)' : 'Approved At (WIB)', value: fmtWib(a.approved_at) },
    );
  }
  if (a.oracle_approval_status && a.oracle_approval_status !== '-') {
    fields.push({ label: 'Oracle Approval Status', value: a.oracle_approval_status });
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'bins', label: 'Adjustment Bins', count: a.items.length },
    { key: 'history', label: 'History', count: a.events.length },
    ...(a.discrepancies.length ? [{ key: 'discrepancies' as Tab, label: 'Discrepancy References', count: a.discrepancies.length }] : []),
    ...(a.integration_logs.length ? [{ key: 'oracle' as Tab, label: 'Oracle Log', count: a.integration_logs.length }] : []),
  ];

  const dialog: Record<Exclude<PendingAction, null>, { kicker: string; title: string; body: string; cta: string; danger?: boolean }> = {
    approve: {
      kicker: 'Inventory Adjustment - Confirm Approve',
      title: 'Approve this adjustment?',
      body: 'The document is sent to Oracle (unless it has no Qty Passed); inventory changes once Oracle approves it.',
      cta: 'Yes, approve',
    },
    reject: {
      kicker: 'Inventory Adjustment - Confirm Reject',
      title: 'Reject this adjustment?',
      body: 'Inventory will not be changed. Please write the reason so the submitter understands the decision.',
      cta: 'Yes, reject',
      danger: true,
    },
    send: {
      kicker: 'Inventory Adjustment - Resend',
      title: 'Resend to Oracle?',
      body: 'The previous send failed and no stock was changed. Resending reuses the same document, so Oracle will not receive a duplicate.',
      cta: 'Yes, resend',
    },
  };

  const actions = (
    <>
      <button
        type="button"
        onClick={() => load(true)}
        aria-label="Refresh"
        title="Refresh"
        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50"
      >
        <svg className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
        </svg>
      </button>
      {a.status === 'WaitingApproval' && canApprove && (
        <>
          <button
            type="button"
            onClick={() => openDialog('reject')}
            className="inline-flex h-[34px] items-center rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-600 shadow-sm hover:bg-red-50"
          >
            Reject
          </button>
          <PrimaryButton onClick={() => openDialog('approve')}>Approve</PrimaryButton>
        </>
      )}
      {/* FR-IA-16 rule 3: an approved document whose Oracle send failed. */}
      {a.status === 'Approved' && a.oracle_error && canApprove && (
        <PrimaryButton onClick={() => openDialog('send')}>Resend to Oracle</PrimaryButton>
      )}
      {a.status === 'WaitingOracleApproval' && (
        <PrimaryButton onClick={checkOracle} disabled={checking}>
          {checking ? 'Checking…' : 'Check Oracle Status'}
        </PrimaryButton>
      )}
    </>
  );

  return (
    <DetailCard title="Detail Inventory Adjustment" backTo="/admin/inventory-adjustments" actions={actions}>
      {/* FR-IA-16 rule 2: the failure is visible with its cause. */}
      {a.oracle_error && (
        <Banner tone="red">
          <b>Oracle send failed.</b> No stock was changed. {a.oracle_error}
        </Banner>
      )}
      {a.status === 'Rejected' && a.approval_reason && (
        <Banner tone="red">
          <b>Rejection reason:</b> {a.approval_reason}
        </Banner>
      )}
      {a.status === 'RejectedByOracle' && (
        <Banner tone="red">
          <b>Rejected by Oracle.</b> No stock was changed. This document is final — create a new one to correct it.{' '}
          {a.oracle_reject_reason ?? ''}
        </Banner>
      )}

      <InfoGrid
        columns={2}
        fields={fields}
        footer={
          <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-slate-700">
            <div className="text-sm font-semibold text-neutral-900 dark:text-white">Memo</div>
            <div className="mt-2 min-h-[42px] rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              {a.memo || <span className="text-neutral-400">-</span>}
            </div>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-6 border-b border-neutral-200 dark:border-slate-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'border-[#5166AE] text-[#5166AE]' : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                tab === t.key ? 'bg-[#E1E4F8] text-[#5166AE]' : 'bg-neutral-100 text-neutral-500'
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-slate-700">
        <div className="overflow-x-auto">
          {tab === 'bins' && <AdjLinesTable lines={a.items} qualityMode={isQuality} />}

          {tab === 'history' && (
            <table className="w-full text-left text-sm">
              <thead className="bg-white text-[#525252]">
                <tr className="[&>th]:border-b [&>th]:border-neutral-100 [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                  <th className="w-12">No</th>
                  <th>Action</th>
                  <th>Status Changes</th>
                  <th>Created By</th>
                  <th>Created At (WIB)</th>
                </tr>
              </thead>
              <tbody className="text-neutral-800">
                {a.events.map((e, i) => (
                  <tr key={e.id} className="[&>td]:border-b [&>td]:border-neutral-100 [&>td]:px-4 [&>td]:py-3">
                    <td>{i + 1}</td>
                    <td>
                      <div className="font-semibold">{eventLabel(e.action)}</div>
                      {e.message && <div className="mt-0.5 max-w-md text-xs text-neutral-500">{e.message}</div>}
                    </td>
                    <td>{e.to_status ? <AdjStatusPill status={e.to_status} compact /> : '-'}</td>
                    <td className="whitespace-nowrap">{e.actor ?? 'System'}</td>
                    <td className="whitespace-nowrap">{fmtWib(e.created_at)}</td>
                  </tr>
                ))}
                {a.events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                      No activity recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'discrepancies' && (
            <table className="w-full text-left text-sm">
              <thead className="bg-white text-[#525252]">
                <tr className="[&>th]:border-b [&>th]:border-neutral-100 [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                  <th className="w-12">No</th>
                  <th>Discrepancy ID</th>
                  <th>Type</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody className="text-neutral-800">
                {a.discrepancies.map((d, i) => (
                  <tr key={d.id} className="[&>td]:border-b [&>td]:border-neutral-100 [&>td]:px-4 [&>td]:py-3">
                    <td>{i + 1}</td>
                    <td>
                      <a href={`/admin/discrepancy/${d.id}`} target="_blank" rel="noreferrer" className="font-medium text-[#5166AE] hover:underline">
                        {d.discrepancy_id} ↗
                      </a>
                    </td>
                    <td className="capitalize">{d.type}</td>
                    <td className="capitalize">{d.from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* FR-IA-13 rule 8 / FR-IA-16 rule 6: raw Oracle traffic for reconciliation. */}
          {tab === 'oracle' && (
            <div className="space-y-3 p-4">
              {a.integration_logs.map((l) => (
                <div key={l.id} className="rounded-lg border border-neutral-200">
                  <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${l.ok ? 'bg-[#EFFAF4] text-[#2E8F5C]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>
                      {l.ok ? 'OK' : 'FAILED'}
                    </span>
                    <span className="font-medium text-neutral-700">{l.operation === 'post' ? 'Send adjustment' : 'Check status'}</span>
                    <span className="font-mono text-neutral-400">{l.endpoint}</span>
                    {l.http_status != null && <span className="text-neutral-400">HTTP {l.http_status}</span>}
                    {l.duration_ms != null && <span className="text-neutral-400">{l.duration_ms} ms</span>}
                    <span className="ml-auto text-neutral-400">{fmtWib(l.created_at)}</span>
                  </div>
                  {l.error && <div className="border-b border-neutral-100 bg-red-50 px-3 py-1.5 text-xs text-red-700">{l.error}</div>}
                  <div className="grid gap-3 p-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-neutral-400">Request</div>
                      <pre className="max-h-48 overflow-auto rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-600">
                        {JSON.stringify(l.request, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-neutral-400">Response</div>
                      <pre className="max-h-48 overflow-auto rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-600">
                        {l.response == null ? '—' : JSON.stringify(l.response, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          {...dialog[pending]}
          busy={busy}
          onCancel={() => !busy && setPending(null)}
          onConfirm={runPending}
          confirmDisabled={pending === 'reject' && !reason.trim()}
        >
          {(pending === 'approve' || pending === 'reject') && (
            <textarea
              className="mt-4 min-h-[68px] w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-[#5166AE] focus:ring-2 focus:ring-[#5166AE]/20"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={pending === 'reject' ? 'Reason for rejection' : 'Note (optional)'}
              autoFocus
            />
          )}
        </ConfirmDialog>
      )}
    </DetailCard>
  );
}

function Banner({ tone, children }: { tone: 'red'; children: ReactNode }) {
  const cls = tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : '';
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

/** WMS dev's small confirmation dialog: kicker, title, text, then Cancel / "Yes, …". */
function ConfirmDialog({
  kicker,
  title,
  body,
  cta,
  danger,
  busy,
  confirmDisabled,
  onCancel,
  onConfirm,
  children,
}: {
  kicker: string;
  title: string;
  body: string;
  cta: string;
  danger?: boolean;
  busy: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={onCancel} />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-[460px] rounded-2xl bg-white p-7 shadow-[0_22px_60px_rgba(15,23,42,0.32)]">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs text-neutral-500">{kicker}</div>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <h2 className="mt-2 text-xl font-semibold text-neutral-900">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">{body}</p>
        {children}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`h-10 rounded-lg px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#5166AE] hover:bg-[#41528c]'
            }`}
          >
            {busy ? 'Working…' : cta}
          </button>
        </div>
      </div>
    </div>
  );
}
