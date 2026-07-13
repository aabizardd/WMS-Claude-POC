import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import type { PurchaseOrderDetail } from '../../types';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-700">{value ?? '—'}</div>
    </div>
  );
}

export default function PoDetailPage() {
  const { id } = useParams();
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<PurchaseOrderDetail>(`/purchase-orders/${id}`)
      .then((r) => active && setPo(r.data))
      .catch(() => active && setError('Purchase order not found'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  }
  if (error || !po) {
    return (
      <div className="card px-6 py-16 text-center text-slate-400">
        {error || 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/inbound/local/po"
          className="mb-1 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Purchase Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{po.po_number ?? po.oracle_id}</h1>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            {po.po_status_label ?? po.po_status}
          </span>
        </div>
      </div>

      <div className="card p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Vendor" value={po.vendor_name} />
          <Field label="PO Date" value={po.po_date} />
          <Field label="Warehouse" value={po.warehouse?.name} />
          <Field label="Location" value={po.location_name} />
          <Field label="Subsidiary" value={po.subsidiary_display} />
          <Field label="Department" value={po.department_display} />
          <Field label="Class" value={po.class_display} />
          <Field label="Currency" value={po.currency_symbol} />
          <Field label="Approval" value={po.approval_status_display} />
          <Field label="Created by" value={po.created_by_netsuite} />
          <Field
            label="Last modified"
            value={po.last_modified ? new Date(po.last_modified).toLocaleString() : '—'}
          />
          <Field label="Memo" value={po.memo || '—'} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
          Line items ({po.lines.length})
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3 text-right">Received</th>
                <th className="px-5 py-3 text-right">Remaining</th>
                <th className="px-5 py-3">Inbound Shipment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.lines.map((l, i) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">
                      {l.item_display ?? l.item_oracle_id ?? '—'}
                    </div>
                    {l.description && (
                      <div className="text-xs text-slate-400">{l.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.quantity.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {l.quantity_received.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">
                    {l.qty_remaining_to_receive.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {l.inbound_shipment_number ?? '—'}
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
