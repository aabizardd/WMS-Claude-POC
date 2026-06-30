import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import type { GoodsReceiveDetail } from '../../types';
import { useAuth } from '../../context/AuthContext';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

interface BinOption {
  id: string;
  binLabel: string;
  binCode: string;
  warehouseId: string;
}

function statusBadgeClass(status: string) {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    Syncing: 'bg-indigo-50 text-indigo-700',
    'Sync Failed': 'bg-rose-50 text-rose-700',
    'On Progress': 'bg-blue-50 text-blue-700',
    'Partially Received': 'bg-blue-50 text-blue-700',
    Received: 'bg-emerald-50 text-emerald-700',
    Completed: 'bg-emerald-50 text-emerald-700',
  };
  const base = map[status] ?? 'bg-slate-100 text-slate-600';
  if (status === 'Syncing') return `${base} animate-pulse`;
  return base;
}

export default function GoodsReceiveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const canUpdate = has('goods-receive:update');

  const [gr, setGr] = useState<GoodsReceiveDetail | null>(null);
  const [bins, setBins] = useState<BinOption[]>([]);
  const [binsLoading, setBinsLoading] = useState(false);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [binSelections, setBinSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState('');
  const [pollTimeout, setPollTimeout] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const grIdRef = useRef(id);

  useEffect(() => {
    grIdRef.current = id;
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id]);

  function hydrate(data: GoodsReceiveDetail) {
    setGr(data);
    setActuals(
      Object.fromEntries(data.items.map((it) => [it.id, it.qty_actual])),
    );
    setBinSelections(
      Object.fromEntries(data.items.map((it) => [it.id, it.bin_id ?? ''])),
    );
  }

  function startPollingStatus() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollStartRef.current = Date.now();
    setPollTimeout(false);

    console.log('[Polling] Starting — id:', grIdRef.current);

    pollRef.current = setInterval(async () => {
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed >= POLL_TIMEOUT_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setPollTimeout(true);
        console.log('[Polling] Timeout after', elapsed, 'ms');
        return;
      }
      try {
        console.log('[Polling] Fetching… (elapsed:', elapsed, 'ms)');
        const r = await api.get<GoodsReceiveDetail>(
          `/goods-receive/${grIdRef.current}`,
        );
        const status = r.data.status;
        console.log('[Polling] Got status:', status, '| items:', r.data.items?.length);

        setGr(r.data);
        setActuals(
          Object.fromEntries(
            r.data.items.map((it) => [it.id, it.qty_actual]),
          ),
        );
        setBinSelections(
          Object.fromEntries(
            r.data.items.map((it) => [it.id, it.bin_id ?? ''])),
        );

        if (status !== 'Syncing') {
          console.log('[Polling] Stopping — status changed to:', status);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e) {
        console.error('[Polling] Error:', e);
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }

  async function fetchBins(warehouseId: string) {
    setBinsLoading(true);
    try {
      const r = await api.get<BinOption[]>('/bins/options', {
        params: { warehouseId },
      });
      setBins(r.data);
    } catch {
      try {
        const r = await api.get<BinOption[]>('/bins/options');
        setBins(r.data);
      } catch {
        setBins([]);
      }
    } finally {
      setBinsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setBins([]);
    api
      .get<GoodsReceiveDetail>(`/goods-receive/${id}`)
      .then(async (r) => {
        if (!active) return;
        hydrate(r.data);
        if (r.data.status === 'Syncing') {
          startPollingStatus();
        }
        if (r.data.warehouse?.id) {
          await fetchBins(r.data.warehouse.id);
        }
      })
      .catch(() => active && setLoadError('Failed to load Goods Receive.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id]);

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!gr) return;
    setError('');
    setSaving(true);
    const payload = {
      items: gr.items.map((it) => ({
        id: it.id,
        qtyActual: Number(actuals[it.id] ?? 0),
        binId: binSelections[it.id] || null,
      })),
    };
    try {
      const r = await api.put<GoodsReceiveDetail>(
        `/goods-receive/${id}/actuals`,
        payload,
      );
      hydrate(r.data);
      setSavedAt(new Date().toLocaleTimeString());
      setConfirmOpen(true);
      setTriggerError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleTriggerReceive() {
    if (!gr) return;
    setTriggerError('');
    setTriggering(true);
    try {
      await api.post(`/goods-receive/${id}/receive`);
      hydrate({ ...gr, status: 'Syncing' });
      setConfirmOpen(false);
      startPollingStatus();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setTriggerError(
          Array.isArray(msg) ? msg.join(', ') : msg ?? 'Receive trigger failed',
        );
      } else setTriggerError('Receive trigger failed');
    } finally {
      setTriggering(false);
    }
  }

  async function handleRetryReceive() {
    setError('');
    try {
      await api.post(`/goods-receive/${id}/receive`);
      startPollingStatus();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Retry failed');
      } else setError('Retry failed');
    }
  }

  function closeConfirm() {
    if (triggering) return;
    setConfirmOpen(false);
    setTriggerError('');
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

  const mrn = gr.mrn;
  const warehouseId = gr.warehouse?.id;
  const isOpen = gr.status === 'Open';
  const editable = canUpdate && isOpen;

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
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(gr.status)}`}
        >
          {gr.status}
          {gr.status === 'Syncing' && '…'}
        </span>
      </div>

      {pollTimeout && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Receive is taking longer than expected. The process continues in the background
          — refresh the page to check the latest status.
        </div>
      )}

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          MRN Information
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Shipment Number" value={mrn.shipment_number} />
          <Meta label="Oracle ID" value={mrn.oracle_id} />
          <Meta label="Oracle Status" value={mrn.oracle_status} />
          <Meta label="Receiving Location" value={mrn.receiving_location_name} />
          <Meta label="Vessel Number" value={mrn.vessel_number} />
          <Meta label="Bill of Lading" value={mrn.bill_of_lading} />
          <Meta label="Port" value={mrn.port} />
          <Meta label="Expected Delivery" value={mrn.expected_delivery_date} />
          <Meta label="Actual Delivery" value={mrn.actual_delivery_date} />
          <Meta label="Memo" value={mrn.memo} />
        </dl>
      </div>

      <form onSubmit={handleConfirm} className="space-y-4">
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
                  <th className="px-5 py-3">Recv. Location</th>
                  <th className="px-5 py-3 text-right">Expected</th>
                  <th className="px-5 py-3 text-right">Remaining</th>
                  <th className="px-5 py-3 text-right">Actual</th>
                  <th className="px-5 py-3">Bin Destination</th>
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
                    <td className="px-5 py-3 text-right text-slate-600">
                      {it.qty_remaining}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input w-28 text-right"
                        value={actuals[it.id] ?? 0}
                        disabled={!editable}
                        onChange={(e) =>
                          setActuals((a) => ({
                            ...a,
                            [it.id]: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                    <td className="px-5 py-3">
                      {!warehouseId ? (
                        <span className="text-xs text-slate-400">
                          No warehouse assigned
                        </span>
                      ) : binsLoading ? (
                        <span className="text-xs text-slate-400">
                          Loading bins…
                        </span>
                      ) : (
                        <select
                          className="input text-sm"
                          value={binSelections[it.id] ?? ''}
                          disabled={!editable}
                          onChange={(e) =>
                            setBinSelections((s) => ({
                              ...s,
                              [it.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">— Select —</option>
                          {bins.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.binLabel} ({b.binCode})
                            </option>
                          ))}
                        </select>
                      )}
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
            {editable ? 'Cancel' : 'Back'}
          </Link>
          {editable && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          )}
          {canUpdate && (gr.status === 'Syncing' || gr.status === 'Sync Failed') && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleRetryReceive}
            >
              Retry
            </button>
          )}
        </div>
      </form>

      <Modal
        open={confirmOpen}
        title="Confirm Receive"
        onClose={closeConfirm}
      >
        <div className="space-y-4">
          {triggerError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {triggerError}
            </div>
          )}

          <p className="text-sm text-slate-600">
            This will send the received quantities to Oracle ERP
            for inbound shipment{' '}
            <strong>
              {gr.shipment_number ?? gr.mrn.oracle_id ?? '—'}
            </strong>{' '}
            with {gr.items.length} item(s).
          </p>
          <p className="text-sm text-slate-500">
            The receive will be processed in the background. GR status will
            change to <strong>Syncing</strong> and then{' '}
            <strong>On Progress</strong> once the ERP confirms.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={closeConfirm}
              disabled={triggering}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleTriggerReceive}
              disabled={triggering}
            >
              {triggering ? 'Submitting…' : 'Confirm Receive'}
            </button>
          </div>
        </div>
      </Modal>
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
