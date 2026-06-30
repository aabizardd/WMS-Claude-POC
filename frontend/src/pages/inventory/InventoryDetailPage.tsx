import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import type { InventoryDetail } from '../../types';

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<InventoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<InventoryDetail>(`/inventory/${id}`)
      .then((r) => active && setInv(r.data))
      .catch(() => active && setError('Failed to load inventory.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (error || !inv) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Inventory not found.'}
        </div>
        <Link to="/admin/inventory" className="btn-secondary">
          ← Back to inventory
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/admin/inventory"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {inv.material_name ?? inv.material_code}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {inv.material_code} · {inv.warehouse_name ?? 'No warehouse'}
          </p>
        </div>
      </div>

      {/* Header info + aggregate quantities */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Material
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Material Name" value={inv.material_name} />
          <Meta label="Material Code" value={inv.material_code} />
          <Meta label="Type" value={inv.material_type} />
          <Meta label="Category" value={inv.material_category} />
          <Meta label="Primary UoM" value={inv.primary_uom} />
          <Meta label="Warehouse" value={inv.warehouse_name} />
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="On Hand" value={inv.on_hand} highlight />
          <Stat label="Reserved" value={inv.reserved_qty} />
          <Stat label="Available" value={inv.avail_qty} />
          <Stat label="In Transit" value={inv.in_transit_qty} />
          <Stat label="Quality Issue" value={inv.quality_issue} />
          <Stat label="Qty Issue" value={inv.qty_issue} />
        </div>
      </div>

      {/* Batches */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Batches ({inv.batches.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">GR Number</th>
                <th className="px-5 py-3">Company (Vendor)</th>
                <th className="px-5 py-3">Bin Location</th>
                <th className="px-5 py-3">Warehouse</th>
                <th className="px-5 py-3 text-right">On Hand</th>
                <th className="px-5 py-3 text-right">Reserved</th>
                <th className="px-5 py-3 text-right">Avail</th>
                <th className="px-5 py-3 text-right">In Transit</th>
                <th className="px-5 py-3 text-right">Qlty Issue</th>
                <th className="px-5 py-3 text-right">Qty Issue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inv.batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {b.gr_number ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {b.company_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {b.bin_location ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {b.warehouse_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-800">
                    {b.on_hand}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {b.reserved_qty}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {b.avail_qty}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {b.in_transit_qty}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {b.quality_issue}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {b.qty_issue}
                  </td>
                </tr>
              ))}
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

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        highlight
          ? 'border-brand-200 bg-brand-50'
          : 'border-slate-200 bg-slate-50'
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`text-lg font-semibold ${
          highlight ? 'text-brand-700' : 'text-slate-800'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
