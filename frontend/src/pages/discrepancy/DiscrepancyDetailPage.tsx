import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import type { DiscrepancyDetail } from '../../types';

function qtyTypeBadge(type: string) {
  const map: Record<string, string> = {
    shortage: 'bg-amber-50 text-amber-700',
    overage: 'bg-emerald-50 text-emerald-700',
    quarantine: 'bg-rose-50 text-rose-700',
  };
  return map[type] ?? 'bg-slate-100 text-slate-600';
}

export default function DiscrepancyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [disc, setDisc] = useState<DiscrepancyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<DiscrepancyDetail>(`/discrepancy/${id}`)
      .then((r) => active && setDisc(r.data))
      .catch(() => active && setError('Failed to load discrepancy.'))
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
  if (error || !disc) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Discrepancy not found.'}
        </div>
        <Link to="/admin/discrepancy" className="btn-secondary">
          ← Back to Discrepancy
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/discrepancy"
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
              {disc.discrepancy_id}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {disc.gr_number ?? '—'} · {disc.discrepancy_type} ·{' '}
              {disc.discrepancy_from}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {disc.details.length} item(s)
        </span>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Info
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Discrepancy ID" value={disc.discrepancy_id} />
          <Meta label="GR Number" value={disc.gr_number} />
          <Meta label="Type" value={disc.discrepancy_type} />
          <Meta label="From" value={disc.discrepancy_from} />
          <Meta label="Reported By" value={disc.reported_by} />
          <Meta label="Warehouse" value={disc.warehouse_name} />
        </dl>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Discrepancy Details ({disc.details.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">PO Number</th>
                <th className="px-5 py-3">Item Name</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3 text-right">Discrepancy</th>
                {disc.discrepancy_type === 'quality' && (
                  <>
                    <th className="px-5 py-3 text-right">Passed</th>
                    <th className="px-5 py-3 text-right">Scrapped</th>
                  </>
                )}
                <th className="px-5 py-3 text-right">Remaining</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {disc.details.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {d.po_number}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {d.item_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{d.source_from}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">
                    {d.qty_discrepancy}
                  </td>
                  {disc.discrepancy_type === 'quality' && (
                    <>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {d.qty_passed}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {d.qty_scrapped}
                      </td>
                    </>
                  )}
                  <td className="px-5 py-3 text-right text-slate-600">
                    {d.qty_remaining}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${qtyTypeBadge(
                        d.qty_discrepancy_type,
                      )}`}
                    >
                      {d.qty_discrepancy_type}
                    </span>
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
