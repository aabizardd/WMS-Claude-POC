import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import type { PackingDetail } from '../../types';

export default function PackingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pk, setPk] = useState<PackingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<PackingDetail>(`/packing/${id}`)
      .then((r) => active && setPk(r.data))
      .catch(() => active && setLoadError('Failed to load Packing.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

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
            to="/admin/outbound/sales-order/packing"
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
        <span className="badge bg-amber-50 text-amber-700">{pk.status}</span>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Packing Document
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Packing ID" value={pk.packing_id} />
          <Meta label="Picking ID" value={pk.picking_id} />
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
          <Meta label="Location" value={pk.location} />
          <Meta label="Customer" value={pk.customer} />
          <Meta label="Status" value={pk.status} />
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
              {pk.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    No items.
                  </td>
                </tr>
              ) : (
                pk.items.map((it) => (
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
