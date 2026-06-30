import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import type { Mrn } from '../../types';

export default function MrnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [mrn, setMrn] = useState<Mrn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<Mrn>(`/mrn/${id}`)
      .then((r) => active && setMrn(r.data))
      .catch(() => active && setError('Failed to load MRN.'))
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
  if (error || !mrn) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'MRN not found.'}
        </div>
        <Link to="/admin/inbound/mrn" className="btn-secondary">
          ← Back to MRN
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/inbound/mrn"
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
              {mrn.shipment_number ?? mrn.oracle_id}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              MRN detail (read-only).
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {mrn.status}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Shipment
          </h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <Meta label="Shipment Number" value={mrn.shipment_number} />
            <Meta label="Oracle ID" value={mrn.oracle_id} />
            <Meta label="Oracle Status" value={mrn.oracle_status} />
            <Meta label="Receiving Location" value={mrn.receiving_location_name} />
            <Meta label="Vessel Number" value={mrn.vessel_number} />
            <Meta label="Bill of Lading" value={mrn.bill_of_lading} />
            <Meta label="Port" value={mrn.port} />
            <Meta label="Date Created" value={mrn.date_created} />
            <Meta label="Memo" value={mrn.memo} />
          </dl>
        </div>
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Goods Receive
          </h3>
          {mrn.goods_receive ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">GR Number</span>
                <span className="font-medium text-slate-700">
                  {mrn.goods_receive.gr_number}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {mrn.goods_receive.status}
                </span>
              </div>
              <Link
                to={`/admin/inbound/goods-receive/${mrn.goods_receive.id}`}
                className="btn-secondary mt-2 w-full"
              >
                Open Goods Receive
              </Link>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No GR document.</p>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Items ({mrn.items.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">PO Number</th>
                <th className="px-5 py-3">Vendor</th>
                <th className="px-5 py-3 text-right">Expected</th>
                <th className="px-5 py-3 text-right">Received</th>
                <th className="px-5 py-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mrn.items.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {it.item_name}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{it.po_number}</td>
                  <td className="px-5 py-3 text-slate-600">{it.vendor_name}</td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.qty_expected}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.qty_received}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.qty_remaining}
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
