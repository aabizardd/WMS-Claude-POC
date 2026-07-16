import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { PackingDetail } from '../../types';

interface RowInput {
  actual: number;
  qtyIssue: number;
  quality: number;
}

// Rows are grouped per material (a merged packing can carry the same material
// from several pickings/bins); target & remaining are summed per group.
function groupKey(it: { material_code: string | null; material_name: string | null; id: string }) {
  return it.material_code ?? it.material_name ?? it.id;
}

interface MaterialGroup {
  key: string;
  material_code: string | null;
  material_name: string | null;
  bins: string[];
  items: PackingDetail['items'];
  qty: number;
  actual: number;
  qtyIssue: number;
  quality: number;
  remaining: number;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    Closed: 'bg-emerald-50 text-emerald-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}

export default function PackingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canUpdate = has('packing:update');

  const [pk, setPk] = useState<PackingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inputs, setInputs] = useState<Record<string, RowInput>>({});
  const [saving, setSaving] = useState(false);

  function resetInputs(data: PackingDetail) {
    // Inputs are keyed per material group, not per underlying packing item.
    const keys = new Set(data.items.map((it) => groupKey(it)));
    setInputs(
      Object.fromEntries([...keys].map((k) => [k, { actual: 0, qtyIssue: 0, quality: 0 }])),
    );
  }

  function load() {
    setLoading(true);
    api
      .get<PackingDetail>(`/packing/${id}`)
      .then((r) => {
        setPk(r.data);
        resetInputs(r.data);
      })
      .catch(() => setLoadError('Failed to load Packing.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const editable = canUpdate && pk?.status !== 'Closed';

  function patch(key: string, p: Partial<RowInput>) {
    setInputs((s) => ({ ...s, [key]: { ...s[key], ...p } }));
  }

  // Material groups: same material merged into one display row, target &
  // remaining summed. Underlying packing items are kept for save distribution.
  const groups = useMemo<MaterialGroup[]>(() => {
    if (!pk) return [];
    const map = new Map<string, MaterialGroup>();
    for (const it of pk.items) {
      const key = groupKey(it);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          material_code: it.material_code,
          material_name: it.material_name,
          bins: [],
          items: [],
          qty: 0,
          actual: 0,
          qtyIssue: 0,
          quality: 0,
          remaining: 0,
        };
        map.set(key, g);
      }
      g.items.push(it);
      if (it.bin_label && !g.bins.includes(it.bin_label)) g.bins.push(it.bin_label);
      g.qty += it.qty;
      g.actual += it.actual_qty;
      g.qtyIssue += it.qty_issue;
      g.quality += it.quality_issue;
      g.remaining += it.remaining_qty;
    }
    return [...map.values()];
  }, [pk]);

  // Realtime totals = stored totals +/- current inputs.
  const live = useMemo(() => {
    if (!pk) return { actual: 0, qtyIssue: 0, quality: 0, remaining: 0 };
    let a = 0,
      qi = 0,
      ql = 0;
    for (const g of groups) {
      const f = inputs[g.key];
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
  }, [pk, groups, inputs]);

  async function handleSave() {
    if (!pk) return;
    // Distribute each group's input across its underlying packing items (fill
    // one item's remaining before moving to the next) — the progress API is
    // unchanged and still works per item.
    const items: { id: string; actualQty: number; qtyIssue: number; qualityIssue: number }[] = [];
    for (const g of groups) {
      const f = inputs[g.key];
      if (!f) continue;
      let a = Number(f.actual) || 0;
      let qi = Number(f.qtyIssue) || 0;
      let ql = Number(f.quality) || 0;
      if (a + qi + ql <= 0) continue;
      if (a + qi + ql > g.remaining + 1e-9) {
        toast.error(`Input exceeds remaining for "${g.material_name ?? g.material_code}".`);
        return;
      }
      for (const it of g.items) {
        let cap = it.remaining_qty;
        const ta = Math.min(cap, a);
        cap -= ta;
        a -= ta;
        const tq = Math.min(cap, qi);
        cap -= tq;
        qi -= tq;
        const tl = Math.min(cap, ql);
        ql -= tl;
        if (ta + tq + tl > 0) {
          items.push({ id: it.id, actualQty: ta, qtyIssue: tq, qualityIssue: tl });
        }
      }
    }

    if (items.length === 0) {
      toast.error('Enter at least one quantity.');
      return;
    }

    const ok = await confirm({
      title: 'Save packing progress?',
      description:
        'The packing status will update automatically. When remaining reaches 0 it will be Closed and inventory/discrepancy settled.',
      type: 'info',
      confirmText: 'Save',
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api.put(`/packing/${id}/progress`, { items });
      toast.success('Packing progress saved');
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
          {loadError || 'Packing not found.'}
        </div>
        <Link to="/admin/outbound/sales-order/packing" className="btn-secondary">
          ← Back to Packing
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to={`${pk.source_type === 'TRANSFER_ORDER' ? '/admin/outbound/transfer-stock' : '/admin/outbound/sales-order'}/packing`}
            className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="page-title">{pk.packing_id}</h1>
            <p className="page-subtitle">
              {pk.customer ?? '—'} · {pk.location ?? 'No location'}
            </p>
          </div>
        </div>
        <span className={`badge ${statusBadge(pk.status)}`}>{pk.status}</span>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Packing Document
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Packing ID" value={pk.packing_id} />
          <Meta label="Picking ID" value={pk.picking_id} />
          {pk.source_type === 'TRANSFER_ORDER' ? (
            <Meta
              label="TO Number"
              value={
                pk.to_id ? (
                  <Link to={`/admin/outbound/transfer-stock/list/${pk.to_id}`} className="text-brand-700 hover:underline">
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
          <Meta label="Status" value={pk.status} />
        </dl>
      </div>

      {/* Realtime summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Summary label="Target Qty" value={pk.totals.request} />
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
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3">Bin</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Actual</th>
                <th className="px-4 py-3 text-right">Qty Issue</th>
                <th className="px-4 py-3 text-right">Quality Issue</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                {editable && <th className="px-4 py-3 text-center">Input (Actual / Qty / Quality)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={editable ? 8 : 7} className="px-5 py-8 text-center text-slate-400">
                    No items.
                  </td>
                </tr>
              ) : (
                groups.map((g) => {
                  const f = inputs[g.key] ?? { actual: 0, qtyIssue: 0, quality: 0 };
                  const rowInput =
                    (Number(f.actual) || 0) + (Number(f.qtyIssue) || 0) + (Number(f.quality) || 0);
                  const rowRemaining = g.remaining - rowInput;
                  const rowEditable = editable && g.remaining > 0;
                  return (
                    <tr key={g.key} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{g.material_code ?? '—'}</div>
                        <div className="text-xs text-slate-400">{g.material_name ?? ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {g.bins.length > 0 ? g.bins.join(', ') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{g.qty}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{g.actual}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{g.qtyIssue}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{g.quality}</td>
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
                                onChange={(e) => patch(g.key, { actual: Number(e.target.value) })}
                              />
                              <input
                                type="number" step="any" min={0}
                                className="input w-16 text-right text-xs"
                                value={f.qtyIssue}
                                onChange={(e) => patch(g.key, { qtyIssue: Number(e.target.value) })}
                              />
                              <input
                                type="number" step="any" min={0}
                                className="input w-16 text-right text-xs"
                                value={f.quality}
                                onChange={(e) => patch(g.key, { quality: Number(e.target.value) })}
                              />
                            </div>
                          ) : (
                            <div className="text-center text-xs text-slate-300">done</div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
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
