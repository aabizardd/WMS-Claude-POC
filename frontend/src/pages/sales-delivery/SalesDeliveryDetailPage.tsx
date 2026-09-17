import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { SalesDeliveryDetail } from '../../types';
import { sdStatusBadge, sdStatusLabel } from './SalesDeliveryListPage';

export default function SalesDeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [d, setD] = useState<SalesDeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<SalesDeliveryDetail>(`/sales-delivery/${id}`)
      .then((r) => {
        setD(r.data);
        setError('');
      })
      .catch((err) => {
        const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
        setError(typeof m === 'string' ? m : 'Sales delivery not found.');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (error || !d) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Sales delivery not found.'}
        </div>
        <Link to="/admin/inventory/sales-delivery" className="btn-secondary">
          ← Back
        </Link>
      </div>
    );
  }

  // Group the lines by material, so several bins of one material read as one block.
  const groups = new Map<string, typeof d.items>();
  for (const it of d.items) {
    const k = it.material_id ?? it.material_code ?? 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/inventory/sales-delivery"
            className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">{d.delivery_number}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {d.from_warehouse ?? '—'} → {d.to_warehouse ?? '—'}
            </p>
          </div>
        </div>
        <span className={`badge ${sdStatusBadge(d.status)}`}>{sdStatusLabel(d.status)}</span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        This document records the transfer only. Bin quantities in the source warehouse are
        not changed by it.
      </div>

      <div className="card p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Delivery No." value={d.delivery_number} />
          <Meta label="Status" value={sdStatusLabel(d.status)} />
          <Meta label="From Location" value={d.from_warehouse} />
          <Meta label="To Location" value={d.to_warehouse} />
          <Meta
            label="Department"
            value={
              d.department_name
                ? `${d.department_name} (${d.department_oracle_id})`
                : d.department_oracle_id
            }
          />
          <Meta
            label="Class"
            value={d.class_name ? `${d.class_name} (${d.class_oracle_id})` : d.class_oracle_id}
          />
          <Meta label="Total Qty Transfer" value={d.total_qty} />
          <Meta label="Memo" value={d.memo} />
          <Meta label="Created By" value={d.created_by} />
          <Meta label="Created" value={new Date(d.created_at).toLocaleString()} />
        </dl>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-700">
            Materials &amp; Bins
            <span className="ml-2 text-xs font-normal text-slate-400">
              {groups.size} material(s) · {d.items.length} bin line(s)
            </span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">Material</th>
                <th className="px-5 py-2.5">Bin</th>
                <th className="px-5 py-2.5 text-right">Available at create</th>
                <th className="px-5 py-2.5 text-right">Qty Transfer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...groups.entries()].flatMap(([k, items]) =>
                items.map((it, i) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      {/* Only the first row of a material repeats its code. */}
                      {i === 0 ? (
                        <>
                          <span className="font-medium text-slate-800">
                            {it.material_code ?? k}
                          </span>
                          {it.material_name ? (
                            <span className="ml-2 text-xs text-slate-400">
                              {it.material_name}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-slate-300">↳</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">{it.bin_label ?? it.bin_id}</td>
                    <td className="px-5 py-2.5 text-right text-slate-500">
                      {it.avail_at_create}
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold text-slate-800">
                      {it.qty_transfer}
                      {it.uom_code ? (
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          {it.uom_code}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-5 py-2.5 text-xs uppercase tracking-wide text-slate-400" colSpan={3}>
                  Total
                </td>
                <td className="px-5 py-2.5 text-right font-semibold text-slate-800">
                  {d.total_qty}
                </td>
              </tr>
            </tfoot>
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
      <dd className="font-medium text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}
