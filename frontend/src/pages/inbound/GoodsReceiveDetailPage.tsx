import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import type { GoodsReceiveDetail } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { grStatusBadgeClass, grStatusLabel } from '../../lib/grStatus';
import SearchableSelect from '../../components/SearchableSelect';
import ActionMenu from '../../components/ActionMenu';
import { printDoc } from '../../lib/print';
import { PrintIcon } from '../../components/icons';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

interface BinOption {
  id: string;
  binLabel: string;
  binCode: string;
  warehouseId: string;
}

function statusBadgeClass(status: string) {
  const base = grStatusBadgeClass(status);
  return status === 'Syncing' ? `${base} animate-pulse` : base;
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

  const [putawayOpen, setPutawayOpen] = useState(false);
  const [putawayLoading, setPutawayLoading] = useState(false);
  const [putawayError, setPutawayError] = useState('');
  const [putawaySuccess, setPutawaySuccess] = useState('');
  const [putawaySuccessModal, setPutawaySuccessModal] = useState(false);
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [putawayPlanned, setPutawayPlanned] = useState<Record<string, number>>({});
  const [putawayPicker, setPutawayPicker] = useState<Record<string, string>>({});

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
          window.dispatchEvent(
            new CustomEvent('gr-status-changed', { detail: { id: grIdRef.current } }),
          );
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

  async function openPutaway() {
    if (!gr) return;
    setPutawayError('');
    setPutawayOpen(true);
    const itemsWithRemaining = gr.items.filter((it) => it.qty_remaining > 0);
    setPutawayPlanned(
      Object.fromEntries(
        itemsWithRemaining.map((it) => [it.id, it.qty_remaining]),
      ),
    );
    setPutawayPicker(
      Object.fromEntries(itemsWithRemaining.map((it) => [it.id, ''])),
    );
    try {
      const r = await api.get<{ id: number; name: string }[]>('/users/pickers', {
        params: { warehouseId: gr.warehouse?.id ?? undefined },
      });
      setPickers(r.data);
    } catch {
      setPickers([]);
    }
  }

  async function handleGeneratePutaway() {
    if (!gr) return;
    setPutawayError('');
    setPutawayLoading(true);
    const itemsWithRemaining = gr.items.filter((it) => it.qty_remaining > 0);
    const payload = {
      items: itemsWithRemaining.map((it) => ({
        mrnItemId: it.id,
        plannedQty: putawayPlanned[it.id] ?? it.qty_remaining,
        pickerId: putawayPicker[it.id]
          ? Number(putawayPicker[it.id])
          : undefined,
      })),
    };
    try {
      const r = await api.post('/putaway/generate', payload);
      setPutawayOpen(false);
      setPutawaySuccess(`Putaway generated successfully: ${r.data.putaway_code}`);
      setPutawaySuccessModal(true);
      const updated = await api.get<GoodsReceiveDetail>(
        `/goods-receive/${id}`,
      );
      hydrate(updated.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setPutawayError(
          Array.isArray(msg) ? msg.join(', ') : msg ?? 'Failed to generate putaway',
        );
      } else setPutawayError('Failed to generate putaway');
    } finally {
      setPutawayLoading(false);
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
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Goods Receive not found.'}
        </div>
        <Link to="/admin/inbound/pib/goods-receive" className="btn-secondary">
          ← Back to Goods Receive
        </Link>
      </div>
    );
  }

  // PO-sourced GR: a read-only view — PO header + the received lines that were
  // submitted to Oracle. The MRN receive/putaway flow below is PIB-only.
  if (gr.source_type === 'PO') {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link
              to="/admin/inbound/local/goods-receive"
              className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Back"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="page-title">{gr.gr_number}</h1>
              <p className="page-subtitle">
                {gr.po?.po_number ?? '—'} · {gr.po?.vendor_name ?? '—'}
              </p>
            </div>
          </div>
          <span className={`badge ${statusBadgeClass(gr.status)}`}>
            {grStatusLabel(gr.status)}
          </span>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Purchase Order Information
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Meta label="GR Number" value={gr.gr_number} />
            <Meta
              label="PO Number"
              value={
                gr.po ? (
                  <Link
                    to={`/admin/inbound/local/po/${gr.po.id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {gr.po.po_number ?? gr.po.oracle_id}
                  </Link>
                ) : (
                  gr.shipment_number
                )
              }
            />
            <Meta label="PO (Oracle ID)" value={gr.po?.oracle_id} />
            <Meta label="Vendor" value={gr.po?.vendor_name} />
            <Meta label="PO Date" value={gr.po?.po_date} />
            <Meta label="PO Status" value={gr.po?.po_status_label ?? gr.po?.po_status} />
            <Meta label="Location" value={gr.po?.location_name} />
            <Meta label="Warehouse" value={gr.warehouse?.name} />
            <Meta label="Created" value={new Date(gr.created_at).toLocaleString()} />
          </dl>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Received Items
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-5 py-3 text-right">Line #</th>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3 text-right">Actual Qty Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gr.po_items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-slate-400">
                      No items.
                    </td>
                  </tr>
                ) : (
                  gr.po_items.map((it) => (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-right text-slate-600">
                        {it.line_number ?? '—'}
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-800">
                        {it.item_display ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {it.qty_actual.toLocaleString()}
                      </td>
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

  const mrn = gr.mrn;
  const warehouseId = gr.warehouse?.id;
  const isOpen = gr.status === 'Open';
  const editable = canUpdate && isOpen;

  function handlePrint() {
    if (!gr) return;
    const m = gr.mrn;
    printDoc({
      title: `Goods Receive — ${gr.gr_number}`,
      subtitle: `${gr.shipment_number ?? '—'} · ${gr.receiving_location_name ?? 'No location'}`,
      meta: [
        { label: 'GR Number', value: gr.gr_number },
        { label: 'Status', value: grStatusLabel(gr.status) },
        { label: 'Shipment Number', value: gr.shipment_number },
        { label: 'Warehouse', value: gr.warehouse?.name },
        { label: 'Oracle ID', value: m.oracle_id },
        { label: 'Oracle Status', value: m.oracle_status },
        { label: 'Receiving Location', value: m.receiving_location_name },
        { label: 'Vessel Number', value: m.vessel_number },
        { label: 'Bill of Lading', value: m.bill_of_lading },
        { label: 'Port', value: m.port },
        { label: 'Expected Delivery', value: m.expected_delivery_date },
        { label: 'Actual Delivery', value: m.actual_delivery_date },
        { label: 'Date Created', value: m.date_created },
        { label: 'Memo', value: m.memo },
      ],
      tables: [
        {
          heading: 'Items',
          columns: ['Item', 'PO Number', 'Vendor', 'Recv. Location', 'Expected', 'Actual', 'Bin Destination'],
          rows: gr.items.map((it) => [
            it.item_name,
            it.po_number,
            it.vendor_name,
            it.receiving_location_name,
            it.qty_expected,
            it.qty_actual,
            it.bin_label,
          ]),
        },
      ],
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/inbound/pib/goods-receive"
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
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(gr.status)}`}
          >
            {grStatusLabel(gr.status)}
            {gr.status === 'Syncing' && '…'}
          </span>
          <ActionMenu
            items={[
              { label: 'Print', icon: <PrintIcon />, onClick: handlePrint },
            ]}
          />
        </div>
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
                        <SearchableSelect
                          className="w-48"
                          value={binSelections[it.id] ?? ''}
                          disabled={!editable}
                          onChange={(v) =>
                            setBinSelections((s) => ({ ...s, [it.id]: v }))
                          }
                          placeholder="— Select —"
                          searchPlaceholder="Search bin…"
                          options={bins.map((b) => ({
                            value: b.id,
                            label: `${b.binLabel} (${b.binCode})`,
                          }))}
                        />
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
          <Link to="/admin/inbound/pib/goods-receive" className="btn-secondary">
            {editable ? 'Cancel' : 'Back'}
          </Link>
          {editable && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          )}
          {canUpdate && (gr.status === 'Syncing' || gr.status === 'SyncFailed') && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleRetryReceive}
            >
              Retry
            </button>
          )}
          {has('putaway:create') && gr.status === 'OnProgress' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={openPutaway}
            >
              Generate Putaway
            </button>
          )}
        </div>
      </form>

      {putawaySuccess && (
        <Modal
          open={putawaySuccessModal}
          title="Putaway Generated"
          onClose={() => setPutawaySuccessModal(false)}
        >
          <div className="space-y-4">
            <p className="text-sm text-emerald-700">{putawaySuccess}</p>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setPutawaySuccessModal(false)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

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

      <Modal
        open={putawayOpen}
        title="Generate Putaway"
        onClose={() => setPutawayOpen(false)}
      >
        <div className="space-y-4">
          {putawayError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {putawayError}
            </div>
          )}

          <p className="text-sm text-slate-500">
            Select items and planned quantities for putaway. Picker assignment
            is optional.
          </p>

          <div className="max-h-80 overflow-y-auto space-y-2">
            {gr.items
              .filter((it) => it.qty_remaining > 0)
              .map((it) => (
                <div
                  key={it.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {it.item_name ?? '—'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      PO: {it.po_number ?? '—'} · Remaining: {it.qty_remaining}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400">
                      Planned Qty
                    </label>
                    <input
                      type="number"
                      step="any"
                      min={1}
                      max={it.qty_remaining}
                      className="input mt-0.5 w-20 text-right text-sm"
                      value={putawayPlanned[it.id] ?? it.qty_remaining}
                      onChange={(e) =>
                        setPutawayPlanned((p) => ({
                          ...p,
                          [it.id]: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400">
                      Picker
                    </label>
                    <SearchableSelect
                      className="mt-0.5 w-40"
                      value={putawayPicker[it.id] ?? ''}
                      onChange={(v) =>
                        setPutawayPicker((p) => ({ ...p, [it.id]: v }))
                      }
                      placeholder="— Auto —"
                      searchPlaceholder="Search picker…"
                      options={pickers.map((pu) => ({
                        value: String(pu.id),
                        label: pu.name,
                      }))}
                    />
                  </div>
                </div>
              ))}
          </div>

          {gr.items.filter((it) => it.qty_remaining > 0).length === 0 && (
            <p className="text-sm text-slate-400 text-center">
              No items with remaining quantity to putaway.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPutawayOpen(false)}
              disabled={putawayLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleGeneratePutaway}
              disabled={
                putawayLoading ||
                gr.items.filter((it) => it.qty_remaining > 0).length === 0
              }
            >
              {putawayLoading ? 'Generating…' : 'Generate Putaway'}
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
