import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../../lib/api';
import Modal from '../../../components/Modal';
import type {
  Paginated,
  PurchaseOrderFilter,
  PurchaseOrderFilterField,
  PurchaseOrderLine,
  PurchaseOrderRow,
  PurchaseOrderSyncResult,
} from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { useSort } from '../../../hooks/useSort';
import SortableTh from '../../../components/SortableTh';
import MultiValueInput from '../../../components/MultiValueInput';
import DateRangeInput, { formatRangeValue } from '../../../components/DateRangeInput';
import RowActionMenu from '../../../components/RowActionMenu';
import TablePager from '../../../components/TablePager';
import { ExportIcon } from '../../../components/ToolbarMenu';
import { soStatusBadgeClass } from '../../../lib/salesOrderStatus';
import {
  AccordionPanelRow,
  DetailIcon,
  ExpandAllButton,
  ExtraFiltersModal,
  FilterField,
  ListFilterPanel,
  ListHeader,
  RefreshButton,
  RowExpandCell,
  expandableRowClass,
  stickyActionsCellClass,
} from '../../../components/ListView';
import { apiError } from '../transfer/transferInbound';
import PoLinesTable from './PoLinesTable';

/** WMS dev's status filter: the Oracle statuses a PO can be received in. */
const STATUSES: [value: string, label: string][] = [
  ['pendingReceipt', 'Pending Receipt'],
  ['pendingBillPartReceived', 'Pending Billing/Partially Received'],
  ['partiallyReceived', 'Partially Received'],
];
/** The list opens on what is waiting to be received. */
const DEFAULT_STATUS = 'pendingReceipt';
/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/** Without a material filter an open row shows at most this many lines. */
const LINE_PREVIEW = 10;

type FieldKind = 'text' | 'date';
interface FieldDef {
  value: PurchaseOrderFilterField;
  label: string;
  kind: FieldKind;
}

/** The list/tracking filter habit: three fields above the table, the rest in "Additional filters". */
const PRIMARY_FIELDS: FieldDef[] = [
  { value: 'material_code', label: 'Part Number', kind: 'text' },
  { value: 'warehouse', label: 'Warehouse', kind: 'text' },
  { value: 'created_at', label: 'Created Date', kind: 'date' },
];
const EXTRA_FIELDS: FieldDef[] = [
  { value: 'material_name', label: 'Material Name', kind: 'text' },
  { value: 'transaction_id', label: 'Transaction ID', kind: 'text' },
  { value: 'erp_doc_id', label: 'ERP Doc ID', kind: 'text' },
];
const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];

type Draft = Partial<Record<PurchaseOrderFilterField, string[]>>;
function draftFrom(filters: PurchaseOrderFilter[]): Draft {
  const d: Draft = {};
  for (const f of filters) d[f.field] = f.values;
  return d;
}
const fieldLabel = (f: PurchaseOrderFilterField) => FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;

/** Filters live in the URL so a refresh or a shared link shows the same list. */
function readFilters(sp: URLSearchParams): PurchaseOrderFilter[] {
  const raw = sp.get('filters');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(FILTER_FIELDS.map((f) => f.value));
    return parsed.flatMap((f): PurchaseOrderFilter[] => {
      const field = (f as PurchaseOrderFilter)?.field;
      const values = (f as PurchaseOrderFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

/** Does this line match a Part Number / Material Name filter? Mirrors the server. */
function lineMatches(l: PurchaseOrderLine, f: PurchaseOrderFilter) {
  const hay = f.field === 'material_code' ? `${l.material_code ?? ''} ${l.item_display ?? ''}` : `${l.material_name ?? ''}`;
  return f.values.some((raw) => !!raw.trim() && hay.toLowerCase().includes(raw.trim().toLowerCase()));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** expand, No, 11 data columns, Action. */
const COLS = 14;

/**
 * Request - PO (Inbound from Local Vendor), as on WMS dev: the Purchase
 * Orders synced from Oracle, each row opening on its lines (requested,
 * received and still to receive). A GR List is generated from the detail.
 */
export default function PoRequestListPage() {
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const canSync = has('purchase-orders:sync');

  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => {
    const st = searchParams.get('status');
    return { filters: readFilters(searchParams), status: st === 'all' ? '' : (st ?? DEFAULT_STATUS) };
  });

  const [data, setData] = useState<Paginated<PurchaseOrderRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState(initial.status);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<PurchaseOrderFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);
  // Every order's lines are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };
  const appliedKey = JSON.stringify(applied);

  const [syncOpen, setSyncOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncLoading, setLastSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncResult, setSyncResult] = useState<PurchaseOrderSyncResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<PurchaseOrderRow>>('/purchase-orders', {
        params: {
          page,
          limit: pageSize,
          status: status || undefined,
          filters: applied.length ? JSON.stringify(applied) : undefined,
          include_items: 'true',
          ...params(),
        },
      })
      .then((r) => !cancelled && setData(r.data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, status, appliedKey, sort.sortBy, sort.order, reloadKey]);

  // Keep the status and filters in the URL ("all" keeps All Status across a reload).
  useEffect(() => {
    const next = new URLSearchParams();
    if (status !== DEFAULT_STATUS) next.set('status', status || 'all');
    if (applied.length) next.set('filters', JSON.stringify(applied));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, appliedKey]);

  async function openSync() {
    setSyncError('');
    setSyncResult(null);
    setSyncOpen(true);
    setLastSyncLoading(true);
    try {
      const r = await api.get<{ lastSyncAt: string | null }>('/purchase-orders/erp-last-sync');
      setLastSyncAt(r.data.lastSyncAt);
    } catch {
      setLastSyncAt(null);
    } finally {
      setLastSyncLoading(false);
    }
  }

  async function handleSync(e: FormEvent) {
    e.preventDefault();
    setSyncError('');
    setSyncResult(null);
    setSyncing(true);
    try {
      const payload = lastSyncAt ? { lastModified: lastSyncAt } : {};
      const r = await api.post<PurchaseOrderSyncResult>('/purchase-orders/sync-erp', payload);
      setSyncResult(r.data);
      setPage(1);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setSyncError(apiError(err, 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  }

  // ----- filters (standard habit) -----
  function runSearch(values: Draft) {
    const next = FILTER_FIELDS.map((f) => ({
      field: f.value,
      values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean),
    })).filter((f) => f.values.length);
    setPage(1);
    setApplied(next);
  }
  function changePrimary(field: PurchaseOrderFilterField, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }
  function appliedExtras(): Draft {
    const fromApplied = draftFrom(applied);
    return Object.fromEntries(EXTRA_FIELDS.map((f) => [f.value, fromApplied[f.value] ?? []]));
  }
  function applyExtras() {
    runSearch(draft);
    setExtraOpen(false);
  }
  function closeExtras() {
    setDraft((d) => ({ ...d, ...appliedExtras() }));
    setExtraOpen(false);
  }
  function resetExtras() {
    setDraft((d) => ({ ...d, ...Object.fromEntries(EXTRA_FIELDS.map((f) => [f.value, []])) }));
  }
  function clearAll() {
    setDraft({});
    setApplied([]);
    setPage(1);
  }
  const extraCount = applied.filter((f) => EXTRA_FIELDS.some((x) => x.value === f.field)).length;

  function renderField(f: FieldDef, onChange: (v: string[]) => void) {
    const values = draft[f.value] ?? [];
    if (f.kind === 'date') return <DateRangeInput value={values[0] ?? ''} onChange={(v) => onChange(v ? [v] : [])} />;
    return (
      <MultiValueInput values={values} onChange={onChange} max={MAX_VALUES} placeholder={`${f.label} — type and press Enter…`} />
    );
  }

  // ----- accordion -----
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const anyOpen = rows.some((r) => !collapsed.has(r.id));
  const lineFilters = applied.filter((f) => f.field === 'material_code' || f.field === 'material_name');
  function toggleRow(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (anyOpen) rows.forEach((r) => next.add(r.id));
      else rows.forEach((r) => next.delete(r.id));
      return next;
    });
  }

  const th = 'whitespace-nowrap';
  const td = 'whitespace-nowrap px-4 py-3 text-slate-700';

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Request - PO"
          subtitle="Record incoming requests for local vendor"
          menu={[{ label: 'Export', icon: <ExportIcon />, onClick: () => toast.info('Export is not available yet.') }]}
        />

        <ListFilterPanel
          columns={4}
          extraCount={extraCount}
          onOpenExtras={() => {
            setDraft((d) => ({ ...d, ...appliedExtras() }));
            setExtraOpen(true);
          }}
          onClear={applied.length > 0 ? clearAll : undefined}
          chips={applied.map((f) => ({
            label: fieldLabel(f.field),
            value: f.values.map((v) => (f.field === 'created_at' ? formatRangeValue(v) : v)).join(' or '),
          }))}
          chipsNote={lineFilters.length > 0 ? 'open orders show only the matching lines' : undefined}
          toolbar={
            <>
              <ExpandAllButton anyOpen={anyOpen} onClick={toggleAll} disabled={rows.length === 0} />
              {/* Refresh pulls the latest orders from Oracle; without the sync
                  permission it just reloads what WMS already has. */}
              <RefreshButton
                onClick={() => (canSync ? openSync() : setReloadKey((k) => k + 1))}
                spinning={loading || syncing}
                title={canSync ? 'Sync from ERP' : 'Refresh'}
              />
            </>
          }
        >
          <FilterField label="Status">
            <select
              className="input"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="">All Status</option>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FilterField>
          {PRIMARY_FIELDS.map((f) => (
            <FilterField key={f.value} label={f.label}>
              {renderField(f, (v) => changePrimary(f.value, v))}
            </FilterField>
          ))}
        </ListFilterPanel>
      </div>

      {/* Nothing here searches until Apply. */}
      <ExtraFiltersModal open={extraOpen} onClose={closeExtras} onReset={resetExtras} onApply={applyExtras}>
        {EXTRA_FIELDS.map((f) => (
          <FilterField key={f.value} label={f.label}>
            {renderField(f, (v) => setDraft((d) => ({ ...d, [f.value]: v })))}
          </FilterField>
        ))}
      </ExtraFiltersModal>

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr className="[&>th]:font-medium [&_button]:normal-case [&_button]:tracking-normal">
                <th className="w-10 px-2 py-3" aria-label="Expand" />
                <th className="px-4 py-3 font-medium">No</th>
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Transaction ID" col="transaction_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="ERP Doc ID" col="oracle_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Ownership" col="ownership" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Vendor Name" col="vendor_name" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Warehouse Name" col="warehouse" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Memo</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Created By</th>
                <SortableTh label="Created At" col="created_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Last Modified By</th>
                <SortableTh label="Last Modified At" col="last_modified" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((po, i) => {
                  const open = !collapsed.has(po.id);
                  const all = po.items ?? [];
                  const matching = lineFilters.length ? all.filter((l) => lineFilters.every((f) => lineMatches(l, f))) : all;
                  // A material filter shows every match; otherwise only the first few.
                  const lines = lineFilters.length ? matching : matching.slice(0, LINE_PREVIEW);
                  const detailPath = `/admin/inbound/local/po/${po.id}`;
                  return [
                    <tr key={po.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(po.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(po.id)} noun="lines" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(po.status)}`}
                        >
                          {po.status ?? '-'}
                        </span>
                      </td>
                      <td className={`${td} text-slate-800`}>{po.po_number ?? '-'}</td>
                      <td className={td}>{po.oracle_id}</td>
                      <td className={td}>{po.ownership ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{po.vendor_name ?? '-'}</td>
                      <td className={td}>{po.warehouse?.name ?? po.location_name ?? '-'}</td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-slate-700" title={po.memo ?? undefined}>
                        {po.memo || '-'}
                      </td>
                      <td className={td}>{po.created_by ?? '-'}</td>
                      <td className={td}>{formatDateTime(po.created_at)}</td>
                      <td className={td}>{po.last_modified_by ?? '-'}</td>
                      <td className={td}>{formatDateTime(po.last_modified)}</td>
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          actions={[{ label: 'Detail', icon: <DetailIcon />, onClick: () => navigate(detailPath) }]}
                        />
                      </td>
                    </tr>,
                    open && (
                      <AccordionPanelRow
                        key={`${po.id}-lines`}
                        colSpan={COLS}
                        title="Line items"
                        noun="lines"
                        total={all.length}
                        matching={matching.length}
                        filtered={lineFilters.length > 0}
                        shown={lines.length}
                        detailPath={detailPath}
                      >
                        <PoLinesTable
                          lines={lines}
                          emptyText={
                            lineFilters.length ? 'No line on this order matches the material filter.' : 'This order has no lines.'
                          }
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    {applied.length > 0 || status
                      ? 'No purchase order matches the filters.'
                      : 'No purchase orders. Click the refresh button to pull data from ERP.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="px-1 pb-1 pt-2">
        <TablePager
          page={page}
          pageSize={pageSize}
          total={data?.total_data ?? 0}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      <Modal open={syncOpen} title="Sync Purchase Orders from ERP" onClose={() => (syncing ? null : setSyncOpen(false))}>
        <form onSubmit={handleSync} className="space-y-4">
          {syncError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{syncError}</div>
          )}
          <p className="text-sm text-slate-500">
            Pull purchase orders (all statuses) from Oracle. Incremental by last modified; existing orders are updated
            in place.
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            {lastSyncLoading ? (
              <span className="text-slate-400">Checking last sync time…</span>
            ) : lastSyncAt ? (
              <>
                <div className="text-slate-500">Last sync (created_at)</div>
                <div className="font-medium text-slate-800">{new Date(lastSyncAt).toLocaleString()}</div>
              </>
            ) : (
              <div className="font-medium text-slate-800">No previous sync — a full sync will run.</div>
            )}
          </div>
          {syncResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="font-medium">{syncResult.fullSync ? 'Full sync' : 'Incremental sync'} complete</div>
              <ul className="mt-1 space-y-0.5 text-emerald-700">
                <li>Total records: {syncResult.totalRecords}</li>
                <li>PO upserted: {syncResult.upserted}</li>
                <li>Skipped (malformed): {syncResult.skipped}</li>
                <li>Failed: {syncResult.failed}</li>
                <li>Duration: {(syncResult.durationMs / 1000).toFixed(1)}s</li>
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setSyncOpen(false)} disabled={syncing}>
              {syncResult ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" className="btn-primary" disabled={syncing || lastSyncLoading}>
              {syncing ? 'Syncing…' : 'Start sync'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
