import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../../lib/api';
import { printDoc } from '../../../lib/print';
import { DocModal, DocTable, ReadOnlyField, Stepper } from '../../../components/wms/DocKit';
import TablePager from '../../../components/TablePager';
import ToolbarMenu, { ExportIcon, PrintIcon } from '../../../components/ToolbarMenu';
import { RefreshButton } from '../../../components/ListView';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { soStatusBadgeClass } from '../../../lib/salesOrderStatus';
import { formatDateTime } from '../../outbound/deliveryColumns';
import type { CustomerReturnDetail, CustomerReturnLine } from '../../../types';
import { apiError, exportCsv } from '../transfer/transferInbound';
import PoLinesTable from '../local/PoLinesTable';

const BASE = '/admin/inbound/customer-return';
/** Oracle statuses a GR List can be generated in (as the backend checks). */
const RECEIVABLE = ['pendingReceipt', 'pendingRefundPartReceived', 'partiallyReceived'];

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/**
 * One Customer Return — WMS preprod's "Detail Request" for Customer Return.
 * Generate GR List makes an Open Goods Receive with planned quantities; the
 * actual receipt (and the Oracle Item Receipt) happens on that GR.
 */
export default function CrDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();

  const [cr, setCr] = useState<CustomerReturnDetail | null>(null);
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
      .get<CustomerReturnDetail>(`/customer-returns/${id}`)
      .then((r) => {
        setCr(r.data);
        setError('');
      })
      .catch(() => setError('Customer return not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => cr?.lines ?? [], [cr]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (l) => (l.material_code ?? '').toLowerCase().includes(q) || (l.material_name ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const canGenerate = has('goods-receive:create') && RECEIVABLE.includes(cr?.status_code ?? '');
  const canTick = (l: CustomerReturnLine) => l.remain_qty > 0;
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
    setPlanned(Object.fromEntries(chosen.map((l) => [l.id, l.remain_qty])));
    setGrOpen(true);
  }

  async function handleGenerate() {
    if (!cr) return;
    setGrError('');
    for (const l of chosen) {
      const q = Number(planned[l.id]);
      const label = l.material_code ?? `line ${l.line_number}`;
      if (!(q > 0)) {
        setGrError(`Planned qty must be greater than 0 for "${label}".`);
        return;
      }
      if (q > l.remain_qty + 1e-9) {
        setGrError(`Planned qty (${q}) exceeds remain (${l.remain_qty}) for "${label}".`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const r = await api.post<{ id: string; gr_number: string }>('/goods-receive/generate-list-from-cr', {
        customerReturnId: cr.id,
        items: chosen.map((l) => ({ lineId: l.id, plannedQty: Number(planned[l.id]) })),
      });
      setGrOpen(false);
      setChecked(new Set());
      setLastGr(r.data);
      toast.success(`GR List generated: ${r.data.gr_number}`);
      load();
    } catch (err) {
      setGrError(apiError(err, 'Generate failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !cr) {
    return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  }
  if (error || !cr) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Customer return not found.'}
        </div>
        <Link to={`${BASE}/requests`} className="btn-secondary">
          ← Back to Request
        </Link>
      </div>
    );
  }

  const listColumns = ['No', 'ERP Line Number', 'Material Code', 'Material Name', 'UoM', 'Request Quantity', 'GR Quantity', 'Receive Quantity', 'Remain Quantity'];
  const listRows = items.map((l, i) => [
    i + 1, l.line_number, l.material_code, l.material_name, l.uom, l.quantity, l.gr_qty, l.receive_qty, l.remain_qty,
  ]);
  const print = () =>
    printDoc({
      title: `Customer Return — ${cr.tran_id ?? cr.oracle_id}`,
      subtitle: `${cr.customer_name ?? '-'} · ${cr.warehouse?.name ?? '-'}`,
      meta: [
        { label: 'Status', value: cr.status },
        { label: 'Transaction ID', value: cr.tran_id },
        { label: 'SO Return Number', value: cr.so_return_number },
        { label: 'ERP Doc ID', value: cr.oracle_id },
        { label: 'Customer Name', value: cr.customer_name },
        { label: 'Warehouse Name', value: cr.warehouse?.name },
        { label: 'Ownership', value: cr.ownership },
        { label: 'Created At', value: formatDateTime(cr.created_at) },
      ],
      tables: [{ heading: 'Material List', columns: listColumns, rows: listRows }],
    });

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`${BASE}/requests`}
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
              { label: 'Print', icon: <PrintIcon />, onClick: print },
              {
                label: 'Export',
                icon: <ExportIcon />,
                onClick: () => exportCsv(`${cr.tran_id ?? cr.oracle_id}.csv`, listColumns, listRows),
              },
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
          <Link to={`${BASE}/goods-receive/${lastGr.id}`} className="font-medium underline">
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
              <span className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(cr.status)}`}>
                {cr.status ?? '-'}
              </span>
            }
          />
          <Info label="Transaction ID" value={cr.tran_id} />
          <Info label="SO Return Number" value={cr.so_return_number} />
          <Info label="ERP Doc ID" value={cr.oracle_id} />
          <Info label="Document Type" value="Customer Return" />
          <Info label="Warehouse Name" value={cr.warehouse?.name ?? cr.location_name} />
          <Info label="Customer Name" value={cr.customer_name} />
          <Info label="Ownership" value={cr.ownership} />
          <Info label="Created By" value={cr.created_by} />
          <Info label="Created At" value={formatDateTime(cr.created_at)} />
          <Info label="Last Modified By" value={cr.last_modified_by} />
          <Info label="Last Modified At" value={formatDateTime(cr.last_modified)} />
        </dl>
        <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
          <div className="text-xs font-semibold text-slate-700">Memo</div>
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-700">{cr.memo || '-'}</div>
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
          <PoLinesTable
            lines={paged}
            startNo={(page - 1) * pageSize + 1}
            showGrQty
            emptyText={search ? 'No material matches the search.' : 'This return has no lines.'}
            selection={
              canGenerate ? { checked, onToggle: toggleOne, onToggleAll: toggleAll, allChecked, someChecked, canTick } : undefined
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

      {/* Generate GR List — as on WMS dev. */}
      <DocModal
        open={grOpen}
        title="Generate GR List"
        subtitle="Set the planned quantity of each material to receive."
        error={grError}
        note={`${chosen.length} material(s) · planned ${fmt(chosen.reduce((s, l) => s + (Number(planned[l.id]) || 0), 0))}`}
        primaryLabel="Generate GR List"
        primaryBusyLabel="Generating…"
        busy={submitting}
        onPrimary={handleGenerate}
        onClose={() => setGrOpen(false)}
      >
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/30">
          <ReadOnlyField label="Transaction ID" value={cr.tran_id} />
          <ReadOnlyField label="ERP Doc ID" value={cr.oracle_id} />
          <ReadOnlyField label="Document Type" value="Customer Return" />
          <ReadOnlyField label="Warehouse" value={cr.warehouse?.name ?? cr.location_name} />
          <ReadOnlyField label="Customer Name" value={cr.customer_name} />
          <ReadOnlyField label="Ownership" value={cr.ownership} />
        </div>
        <div className="space-y-3">
          <div className="text-base font-semibold text-neutral-900 dark:text-white">Material List</div>
          <DocTable
            rows={chosen}
            columns={[
              { label: 'No', render: (_l, i) => i + 1 },
              {
                label: 'Material',
                render: (l) => (
                  <div className="max-w-[18rem]">
                    <div className="truncate font-medium">{l.material_name ?? '-'}</div>
                    <span className="mt-1 inline-flex rounded-md bg-[#E1E4F8] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#5166AE]">
                      PN · {l.material_code ?? '-'}
                    </span>
                  </div>
                ),
              },
              { label: 'Request Qty', align: 'right', render: (l) => fmt(l.quantity) },
              { label: 'Remain Qty', align: 'right', render: (l) => fmt(l.remain_qty) },
              {
                label: 'Planned Qty *',
                align: 'center',
                render: (l) => (
                  <Stepper
                    value={Number(planned[l.id]) || 0}
                    max={l.remain_qty}
                    invalid={(Number(planned[l.id]) || 0) > l.remain_qty}
                    onChange={(v) => setPlanned((p) => ({ ...p, [l.id]: v }))}
                  />
                ),
              },
              { label: 'UoM', render: (l) => l.uom ?? '-' },
            ]}
          />
        </div>
      </DocModal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-700">{label}</dt>
      <dd className="mt-1 text-slate-700">{value === null || value === undefined || value === '' ? '-' : value}</dd>
    </div>
  );
}
