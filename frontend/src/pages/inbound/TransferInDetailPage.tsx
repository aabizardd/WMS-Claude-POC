import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import TablePager from '../../components/TablePager';
import ToolbarMenu, { ExportIcon, PrintIcon } from '../../components/ToolbarMenu';
import { RefreshButton } from '../../components/ListView';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { soStatusBadgeClass } from '../../lib/salesOrderStatus';
import { formatDateTime } from '../outbound/deliveryColumns';
import type { TransferOrderLine } from '../../types';
import TransferInLinesTable from './TransferInLinesTable';

interface InboundTransferOrder {
  id: string;
  oracle_id: string;
  tran_id: string | null;
  status_name: string | null;
  ownership: string | null;
  origin_warehouse: string | null;
  destination_warehouse_id: string | null;
  destination_warehouse: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  last_modified_by: string | null;
  last_modified: string | null;
  items: TransferOrderLine[];
}

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/**
 * One Transfer Order seen from its destination warehouse — WMS dev's "Detail
 * Request" for an inbound TO. Generate GR List makes an Open Goods Receive
 * with planned quantities; the actual receipt (and the Oracle Item Receipt)
 * happens on that GR.
 */
export default function TransferInDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const canGenerate = has('goods-receive:create');

  const [to, setTo] = useState<InboundTransferOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [grOpen, setGrOpen] = useState(false);
  const [grError, setGrError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [planned, setPlanned] = useState<Record<string, number>>({});
  const [lastGr, setLastGr] = useState<{ id: string; gr_number: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<InboundTransferOrder>(`/transfer-orders/inbound/${id}`)
      .then((r) => {
        setTo(r.data);
        setError('');
      })
      .catch(() => setError('Transfer order not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => to?.items ?? [], [to]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (l) =>
        (l.material_code ?? l.item_name ?? '').toLowerCase().includes(q) ||
        (l.material_name ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const canTick = (l: TransferOrderLine) => (l.remain_qty ?? 0) > 0;
  const tickable = filtered.filter(canTick);
  const allChecked = tickable.length > 0 && tickable.every((l) => checked.has(l.id));
  const someChecked = tickable.some((l) => checked.has(l.id));
  const chosen = items.filter((l) => checked.has(l.id));

  function toggleOne(lineId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const l of tickable) {
        if (allChecked) next.delete(l.id);
        else next.add(l.id);
      }
      return next;
    });
  }

  function openGenerate() {
    if (!chosen.length) {
      toast.info('Tick the materials to put on the GR List first.');
      return;
    }
    setGrError('');
    setPlanned(Object.fromEntries(chosen.map((l) => [l.id, l.remain_qty ?? 0])));
    setGrOpen(true);
  }

  async function handleGenerate() {
    if (!to) return;
    setGrError('');
    for (const l of chosen) {
      const q = Number(planned[l.id]);
      const label = l.material_code ?? l.item_name ?? `line ${l.line_number}`;
      if (!(q > 0)) {
        setGrError(`Planned qty must be greater than 0 for "${label}".`);
        return;
      }
      if (q > (l.remain_qty ?? 0) + 1e-9) {
        setGrError(`Planned qty (${q}) exceeds remain (${l.remain_qty ?? 0}) for "${label}".`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const r = await api.post<{ id: string; gr_number: string }>('/goods-receive/generate-list-from-to', {
        transferOrderId: to.id,
        items: chosen.map((l) => ({ lineId: l.id, plannedQty: Number(planned[l.id]) })),
      });
      setGrOpen(false);
      setChecked(new Set());
      setLastGr(r.data);
      toast.success(`GR List generated: ${r.data.gr_number}`);
      load();
    } catch (err) {
      let msg = 'Generate failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : (m ?? msg);
      }
      setGrError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !to) {
    return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  }
  if (error || !to) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Transfer order not found.'}
        </div>
        <Link to="/admin/inbound/transfer/to" className="btn-secondary">
          ← Back to Request
        </Link>
      </div>
    );
  }

  const notYet = () => toast.info('This is not available yet.');

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/inbound/transfer/to"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Detail Request</h1>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarMenu
            items={[
              { label: 'Print', icon: <PrintIcon />, onClick: notYet },
              { label: 'Export', icon: <ExportIcon />, onClick: notYet },
            ]}
          />
          <RefreshButton onClick={load} spinning={loading} />
          {canGenerate && (
            <button className="btn-primary" onClick={openGenerate}>
              Generate GR List
              {checked.size > 0 && <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">{checked.size}</span>}
            </button>
          )}
        </div>
      </div>

      {lastGr && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          GR List generated:{' '}
          <Link to={`/admin/inbound/transfer/goods-receive/${lastGr.id}`} className="font-medium underline">
            {lastGr.gr_number}
          </Link>{' '}
          — open it to enter the actual qty and Receive.
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm lg:grid-cols-4">
          <Info
            label="Status"
            value={
              <span
                className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(to.status_name)}`}
              >
                {to.status_name ?? '-'}
              </span>
            }
          />
          <Info label="Transaction ID" value={to.tran_id} />
          <Info label="ERP Doc ID" value={to.oracle_id} />
          <Info label="Document Type" value="Transfer Order" />
          <Info label="Origin Warehouse" value={to.origin_warehouse} />
          <Info label="Destination Warehouse" value={to.destination_warehouse} />
          <Info label="Ownership" value={to.ownership} />
          <Info label="Created By" value={to.created_by} />
          <Info label="Created At" value={formatDateTime(to.created_at)} />
          <Info label="Last Modified By" value={to.last_modified_by} />
          <Info label="Last Modified At" value={formatDateTime(to.last_modified)} />
        </dl>
        <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
          <div className="text-xs font-semibold text-slate-700">Memo</div>
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-700">
            {to.memo || '-'}
          </div>
        </div>
      </div>

      {/* Material List */}
      <h3 className="mb-3 mt-6 text-base font-semibold text-slate-800">Material List</h3>
      <div className="relative mb-3 w-full max-w-xs">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          className="input pl-9"
          placeholder="Search by Material Name or Code..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <TransferInLinesTable
            lines={paged}
            startNo={(page - 1) * pageSize + 1}
            emptyText={search ? 'No material matches the search.' : 'This order has no lines.'}
            selection={
              canGenerate
                ? { checked, onToggle: toggleOne, onToggleAll: toggleAll, allChecked, someChecked, canTick }
                : undefined
            }
          />
        </div>
        <TablePager
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {/* Generate GR List */}
      <Modal
        open={grOpen}
        title="Generate GR List"
        maxWidthClass="max-w-3xl"
        onClose={() => (submitting ? null : setGrOpen(false))}
      >
        <div className="space-y-4">
          {grError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{grError}</div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReadOnly label="Transaction ID" value={to.tran_id} />
            <ReadOnly label="ERP Doc ID" value={to.oracle_id} />
            <ReadOnly label="Document Type" value="Transfer Order" />
            <ReadOnly label="Warehouse" value={to.destination_warehouse} />
            <ReadOnly label="Origin Warehouse" value={to.origin_warehouse} />
            <ReadOnly label="Ownership" value={to.ownership} />
          </div>

          <h4 className="text-sm font-semibold text-slate-800">Material List</h4>
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium">
                  <th>No</th>
                  <th>Material Code</th>
                  <th>Material Name</th>
                  <th className="text-right">Request Qty</th>
                  <th className="text-right">Remain Qty</th>
                  <th className="text-right">
                    Planned Qty <span className="text-rose-500">*</span>
                  </th>
                  <th>UoM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {chosen.map((l, i) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-800">{l.material_code ?? l.item_name ?? '-'}</td>
                    <td className="px-3 py-2 text-slate-700">{l.material_name ?? '-'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmt(l.quantity)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmt(l.remain_qty)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        max={l.remain_qty}
                        className="input w-28 text-right"
                        value={planned[l.id] ?? 0}
                        onChange={(e) => setPlanned((p) => ({ ...p, [l.id]: Number(e.target.value) }))}
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-700">{l.uom ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setGrOpen(false)} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleGenerate} disabled={submitting}>
              {submitting ? 'Generating…' : 'Generate GR List'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-700">{label}</dt>
      <dd className="mt-1 text-slate-700">
        {value === null || value === undefined || value === '' ? '-' : value}
      </dd>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-700">{label}</span>
      <input className="input bg-slate-50 text-slate-600" value={value ?? '-'} disabled />
    </label>
  );
}
