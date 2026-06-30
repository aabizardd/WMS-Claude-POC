import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { GoodsReceiveDetail } from '../../types';
import { useAuth } from '../../context/AuthContext';

export default function GoodsReceiveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const canUpdate = has('goods-receive:update');

  const [gr, setGr] = useState<GoodsReceiveDetail | null>(null);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function hydrate(data: GoodsReceiveDetail) {
    setGr(data);
    setActuals(
      Object.fromEntries(data.items.map((it) => [it.id, it.qty_actual])),
    );
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<GoodsReceiveDetail>(`/goods-receive/${id}`)
      .then((r) => active && hydrate(r.data))
      .catch(() => active && setLoadError('Failed to load Goods Receive.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!gr) return;
    setError('');
    setSaving(true);
    const payload = {
      items: gr.items.map((it) => ({
        id: it.id,
        qtyActual: Number(actuals[it.id] ?? 0),
      })),
    };
    try {
      const r = await api.put<GoodsReceiveDetail>(
        `/goods-receive/${id}/actuals`,
        payload,
      );
      hydrate(r.data);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (loadError || !gr) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Goods Receive not found.'}
        </div>
        <Link to="/admin/inbound/goods-receive" className="btn-secondary">
          ← Back to Goods Receive
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/inbound/goods-receive"
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
              {gr.gr_number}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {gr.shipment_number ?? '—'} ·{' '}
              {gr.receiving_location_name ?? 'No location'}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          {gr.status}
        </span>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Items — enter actual received quantity
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">PO Number</th>
                  <th className="px-5 py-3">Vendor</th>
                  <th className="px-5 py-3">Receiving Location</th>
                  <th className="px-5 py-3 text-right">Expected</th>
                  <th className="px-5 py-3 text-right">Actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gr.items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-800">
                        {it.item_name}
                      </div>
                      {it.item_description && (
                        <div className="text-xs text-slate-400">
                          {it.item_description}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{it.po_number}</td>
                    <td className="px-5 py-3 text-slate-600">{it.vendor_name}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {it.receiving_location_name ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {it.qty_expected}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input w-28 text-right"
                        value={actuals[it.id] ?? 0}
                        disabled={!canUpdate}
                        onChange={(e) =>
                          setActuals((a) => ({
                            ...a,
                            [it.id]: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {savedAt && (
            <span className="text-xs text-emerald-600">Saved at {savedAt}</span>
          )}
          <Link to="/admin/inbound/goods-receive" className="btn-secondary">
            {canUpdate ? 'Cancel' : 'Back'}
          </Link>
          {canUpdate && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save actuals'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
