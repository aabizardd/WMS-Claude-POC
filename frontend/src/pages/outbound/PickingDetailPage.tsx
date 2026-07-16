import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { PickingDetail } from '../../types';

interface RowInput {
  actual: number;
  qtyIssue: number;
  quality: number;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    OnProgress: 'bg-blue-50 text-blue-700',
    Closed: 'bg-emerald-50 text-emerald-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}
function statusLabel(status: string) {
  return status === 'OnProgress' ? 'On Progress' : status;
}

export default function PickingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canUpdate = has('picking:update');

  const [pk, setPk] = useState<PickingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inputs, setInputs] = useState<Record<string, RowInput>>({});
  const [saving, setSaving] = useState(false);

  function resetInputs(data: PickingDetail) {
    setInputs(
      Object.fromEntries(
        data.items.map((it) => [it.id, { actual: 0, qtyIssue: 0, quality: 0 }]),
      ),
    );
  }

  function load() {
    setLoading(true);
    api
      .get<PickingDetail>(`/picking/${id}`)
      .then((r) => {
        setPk(r.data);
        resetInputs(r.data);
      })
      .catch(() => setLoadError('Failed to load Picking.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const editable = canUpdate && pk?.status !== 'Closed';

  function patch(itemId: string, p: Partial<RowInput>) {
    setInputs((s) => ({ ...s, [itemId]: { ...s[itemId], ...p } }));
  }

  // Realtime totals = stored totals +/- current inputs.
  const live = useMemo(() => {
    if (!pk) return { actual: 0, qtyIssue: 0, quality: 0, remaining: 0 };
    let a = 0,
      qi = 0,
      ql = 0;
    for (const it of pk.items) {
      const f = inputs[it.id];
      if (!f) continue;
      a += Number(f.actual) || 0;
      qi += Number(f.qtyIssue) || 0;
      ql += Number(f.quality) || 0;
    }
    return {
      actual: pk.totals.actual + a,
      qtyIssue: pk.totals.qty_issue + qi,
      quality: pk.totals.quality_issue + ql,
      remaining: pk.totals.remaining - (a + qi + ql),
    };
  }, [pk, inputs]);

  async function handleSave() {
    if (!pk) return;
    const items = pk.items
      .map((it) => {
        const f = inputs[it.id] ?? { actual: 0, qtyIssue: 0, quality: 0 };
        return {
          id: it.id,
          actualQty: Number(f.actual) || 0,
          qtyIssue: Number(f.qtyIssue) || 0,
          qualityIssue: Number(f.quality) || 0,
        };
      })
      .filter((x) => x.actualQty + x.qtyIssue + x.qualityIssue > 0);

    if (items.length === 0) {
      toast.error('Enter at least one quantity.');
      return;
    }
    // Client-side guard: per-item input must not exceed its remaining.
    for (const it of pk.items) {
      const f = inputs[it.id];
      if (!f) continue;
      const sum = (Number(f.actual) || 0) + (Number(f.qtyIssue) || 0) + (Number(f.quality) || 0);
      if (sum > it.remaining_qty + 1e-9) {
        toast.error(`Input exceeds remaining for "${it.material_name ?? it.material_code}".`);
        return;
      }
    }

    const ok = await confirm({
      title: 'Save picking progress?',
      description:
        'The picking status will update automatically. When remaining reaches 0 it will be Closed and inventory/discrepancy settled.',
      type: 'info',
      confirmText: 'Save',
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api.put(`/picking/${id}/progress`, { items });
      toast.success('Picking progress saved');
      load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (loadError || !pk) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Picking not found.'}
        </div>
        <Link to="/admin/outbound/sales-order/picking" className="btn-secondary">
          ← Back to Picking
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to={`${pk.source_type === 'TRANSFER_ORDER' ? '/admin/outbound/transfer-stock' : '/admin/outbound/sales-order'}/picking`}
            className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="page-title">{pk.picking_id}</h1>
            <p className="page-subtitle">
              {pk.customer ?? '—'} · {pk.location ?? 'No location'}
            </p>
          </div>
        </div>
        <span className={`badge ${statusBadge(pk.status)}`}>{statusLabel(pk.status)}</span>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Picking Document
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Picking ID" value={pk.picking_id} />
          {pk.source_type === 'TRANSFER_ORDER' ? (
            <Meta
              label="TO Number"
              value={
                pk.to_id ? (
                  <Link
                    to={`/admin/outbound/transfer-stock/list/${pk.to_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {pk.to_number ?? '—'}
                  </Link>
                ) : (
                  pk.to_number
                )
              }
            />
          ) : (
            <Meta
              label="SO Number"
              value={
                pk.so_id ? (
                  <Link to={`/admin/outbound/sales-order/list/${pk.so_id}`} className="text-brand-700 hover:underline">
                    {pk.so_number ?? '—'}
                  </Link>
                ) : (
                  pk.so_number
                )
              }
            />
          )}
          <Meta label="Location" value={pk.location} />
          <Meta
            label={pk.source_type === 'TRANSFER_ORDER' ? 'Warehouse Destination' : 'Customer'}
            value={pk.customer}
          />
          <Meta label="Status" value={statusLabel(pk.status)} />
        </dl>
      </div>

      {/* Realtime summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Summary label="Request Qty" value={pk.totals.request} />
        <Summary label="Total Actual" value={live.actual} accent="text-brand-700" />
        <Summary label="Total Qty Issue" value={live.qtyIssue} accent="text-amber-700" />
        <Summary label="Total Quality Issue" value={live.quality} accent="text-rose-700" />
        <Summary label="Remaining (realtime)" value={live.remaining} accent="text-slate-800" />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Material Detail
          </h3>
          {editable && (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Progress'}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3">Bin</th>
                <th className="px-4 py-3 text-right">Request</th>
                <th className="px-4 py-3 text-right">Actual</th>
                <th className="px-4 py-3 text-right">Qty Issue</th>
                <th className="px-4 py-3 text-right">Quality Issue</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                {editable && <th className="px-4 py-3 text-center">Input (Actual / Qty / Quality)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pk.items.map((it) => {
                const f = inputs[it.id] ?? { actual: 0, qtyIssue: 0, quality: 0 };
                const rowInput =
                  (Number(f.actual) || 0) + (Number(f.qtyIssue) || 0) + (Number(f.quality) || 0);
                const rowRemaining = it.remaining_qty - rowInput;
                const rowEditable = editable && it.remaining_qty > 0;
                return (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className={`badge ${statusBadge(it.status)}`}>
                        {statusLabel(it.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{it.material_code ?? '—'}</div>
                      <div className="text-xs text-slate-400">{it.material_name ?? ''}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{it.bin_label ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{it.request_qty}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{it.actual_qty}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{it.qty_issue}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{it.quality_issue}</td>
                    <td className={`px-4 py-3 text-right font-medium ${rowRemaining < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                      {rowRemaining}
                    </td>
                    {editable && (
                      <td className="px-4 py-3">
                        {rowEditable ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <input
                              type="number" step="any" min={0}
                              className="input w-16 text-right text-xs"
                              value={f.actual}
                              onChange={(e) => patch(it.id, { actual: Number(e.target.value) })}
                            />
                            <input
                              type="number" step="any" min={0}
                              className="input w-16 text-right text-xs"
                              value={f.qtyIssue}
                              onChange={(e) => patch(it.id, { qtyIssue: Number(e.target.value) })}
                            />
                            <input
                              type="number" step="any" min={0}
                              className="input w-16 text-right text-xs"
                              value={f.quality}
                              onChange={(e) => patch(it.id, { quality: Number(e.target.value) })}
                            />
                          </div>
                        ) : (
                          <div className="text-center text-xs text-slate-300">done</div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value, accent = 'text-slate-800' }: { label: string; value: number; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent}`}>{value}</div>
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
