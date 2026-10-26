import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import GeneratePickingModal, {
  type PickAllocation,
} from '../../components/GeneratePickingModal';
import TablePager from '../../components/TablePager';
import ToolbarMenu, { ExportIcon, PrintIcon } from '../../components/ToolbarMenu';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { soStatusBadgeClass } from '../../lib/salesOrderStatus';
import type { Pickable, TransferOrderDetail, TransferOrderLine } from '../../types';

// TO statuses that allow generating a picking (remaining = committed-based).
const TO_PICKABLE_STATUSES = [
  'Pending Fulfillment',
  'Pending Receipt/Partially Fulfilled',
  'Partially Fulfilled',
];

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/** Strip Oracle's "REGION : " prefix from a location name ("JAWA : Jakarta - IEL"). */
const locationName = (v: string | null | undefined) => (v ? v.replace(/^[^:]+:\s*/, '') : null);

export default function TransferOrderDetailPage() {
  const { id } = useParams();
  const { has } = useAuth();
  const toast = useToast();
  const canGenerate = has('picking:create');

  const [to, setTo] = useState<TransferOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Material List: searched, paged and ticked on the client.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Generate Picking modal state.
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pickable, setPickable] = useState<Pickable | null>(null);
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [preselected, setPreselected] = useState<string[]>([]);

  function loadTo() {
    setLoading(true);
    api
      .get<TransferOrderDetail>(`/transfer-orders/${id}`)
      .then((r) => setTo(r.data))
      .catch(() => setError('Transfer order not found'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<TransferOrderDetail>(`/transfer-orders/${id}`)
      .then((r) => active && setTo(r.data))
      .catch(() => active && setError('Transfer order not found'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

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

  /** Only lines with something left to pick can be ticked. */
  const tickable = (l: TransferOrderLine) => (l.remaining_qty ?? 0) > 0;
  const tickableShown = filtered.filter(tickable);
  const allShownTicked =
    tickableShown.length > 0 && tickableShown.every((l) => checked.has(l.id));
  const someShownTicked = tickableShown.some((l) => checked.has(l.id));

  function toggleOne(lineId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }
  function toggleAllShown() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allShownTicked) tickableShown.forEach((l) => next.delete(l.id));
      else tickableShown.forEach((l) => next.add(l.id));
      return next;
    });
  }

  async function openGenerate() {
    // Ticked lines start selected in the modal; with none ticked, every line
    // that still has something to pick does.
    setPreselected(checked.size > 0 ? [...checked] : items.filter(tickable).map((l) => l.id));
    setGenError('');
    setSuccessMsg('');
    setGenOpen(true);
    setGenLoading(true);
    try {
      const [p, pk] = await Promise.all([
        api.get<Pickable>(`/picking/pickable-transfer/${id}`),
        api.get<{ id: number; name: string }[]>('/users/pickers', {
          params: { warehouseId: to?.warehouse?.id ?? undefined },
        }),
      ]);
      setPickable(p.data);
      setPickers(pk.data);
    } catch {
      setGenError('Failed to load picking data.');
    } finally {
      setGenLoading(false);
    }
  }

  async function handleGenerate(allocations: PickAllocation[]) {
    setSubmitting(true);
    try {
      const payload = {
        transferOrderId: id,
        items: allocations.map((a) => ({
          transferOrderItemId: a.itemId,
          requestQty: a.qty,
          binId: a.binId,
          pickerId: a.pickerId,
        })),
      };
      const r = await api.post<{ picking_id: string }>('/picking/generate', payload);
      setGenOpen(false);
      setChecked(new Set());
      setSuccessMsg(`Picking generated: ${r.data.picking_id}`);
      loadTo();
    } catch (err) {
      let msg = 'Generate failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : m ?? msg;
      }
      throw new Error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !to) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>;
  }
  if (error || !to) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Transfer order not found.'}
        </div>
        <Link to="/admin/outbound/transfer-stock/list" className="btn-secondary">
          ← Back to Transfer Order
        </Link>
      </div>
    );
  }

  const showGenerate = canGenerate && TO_PICKABLE_STATUSES.includes(to.status_name ?? '');
  const notYet = () => toast.info('This is not available yet.');

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/outbound/transfer-stock/list"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Transfer Order Detail</h1>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarMenu
            items={[
              { label: 'Print', icon: <PrintIcon />, onClick: notYet },
              { label: 'Export', icon: <ExportIcon />, onClick: notYet },
            ]}
          />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
            onClick={loadTo}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
            </svg>
          </button>
          {showGenerate && (
            <button className="btn-primary" onClick={openGenerate}>
              Generate Picking List
              {checked.size > 0 && (
                <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">{checked.size}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {successMsg}
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm lg:grid-cols-4">
          <Info
            label="Status"
            value={
              <span
                className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(
                  to.status_name,
                )}`}
              >
                {to.status_name ?? '-'}
              </span>
            }
          />
          <Info label="Transaction ID" value={to.tran_id} />
          <Info label="TO ID" value="-" />
          <Info label="Doc Type" value="Transfer Order" />
          <Info label="Ownership" value={to.ownership} />
          <Info label="Origin Warehouse" value={to.warehouse?.name ?? locationName(to.from_location_name)} />
          <Info label="Destination Warehouse" value={locationName(to.to_location_name)} />
          <Info label="ERP Doc ID" value={to.oracle_id} />
        </dl>
      </div>

      {/* Material List */}
      <h3 className="mb-3 mt-6 text-base font-semibold text-slate-800">Material List</h3>
      <div className="relative mb-3 w-full max-w-xs">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                <th className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                    checked={allShownTicked}
                    ref={(el) => {
                      if (el) el.indeterminate = someShownTicked && !allShownTicked;
                    }}
                    disabled={!showGenerate || tickableShown.length === 0}
                    onChange={toggleAllShown}
                    aria-label="Select every line with quantity left"
                  />
                </th>
                <th>No</th>
                <th>Material Code</th>
                <th>Material Name</th>
                <th>UOM</th>
                <th className="text-right">Available Qty</th>
                <th className="text-right">Request Qty</th>
                <th className="text-right">Given Qty</th>
                <th className="text-right">Remaining Qty</th>
                <th className="text-right">Actual Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((l, i) => (
                <tr key={l.id} className={checked.has(l.id) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      checked={checked.has(l.id)}
                      disabled={!showGenerate || !tickable(l)}
                      onChange={() => toggleOne(l.id)}
                      title={tickable(l) ? undefined : 'Nothing left to pick'}
                      aria-label={`Select ${l.material_code ?? l.item_name ?? 'line'}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-800">
                    {l.material_code ?? l.item_name ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{l.material_name ?? l.description ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{l.uom ?? '-'}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{fmt(l.available_qty)}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{fmt(l.quantity)}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{fmt(l.given_qty)}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{fmt(l.remaining_qty)}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{fmt(l.actual_delivery)}</td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    {search ? 'No material matches the search.' : 'This order has no lines.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

      <GeneratePickingModal
        open={genOpen}
        loading={genLoading}
        submitting={submitting}
        pickable={pickable}
        pickers={pickers}
        docInfo={[
          { label: 'Transaction ID', value: to.tran_id },
          { label: 'TO ID', value: '-' },
          { label: 'ERP Doc ID', value: to.oracle_id },
          { label: 'Doc Type', value: 'Transfer Order' },
          { label: 'Origin Warehouse', value: to.warehouse?.name ?? locationName(to.from_location_name) },
          { label: 'Ownership', value: to.ownership },
          { label: 'Destination Warehouse', value: locationName(to.to_location_name) },
        ]}
        loadError={genError}
        remainingHint="remaining (committed)"
        preselectedIds={preselected}
        onClose={() => setGenOpen(false)}
        onSubmit={handleGenerate}
      />
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
