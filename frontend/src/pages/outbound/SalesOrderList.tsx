import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { downloadFile } from '../../lib/download';
import Modal from '../../components/Modal';
import type {
  Paginated,
  SalesOrderFilter,
  SalesOrderFilterField,
  SalesOrderItemRow,
  SalesOrderRow,
  SalesOrderSyncResult,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';
import MultiValueInput from '../../components/MultiValueInput';
import MultiValueSelect from '../../components/MultiValueSelect';
import DateRangeInput, { formatRangeValue } from '../../components/DateRangeInput';
import RowActionMenu from '../../components/RowActionMenu';
import TablePager from '../../components/TablePager';
import { ExportIcon } from '../../components/ToolbarMenu';
import { SO_STATUSES, soStatusBadgeClass } from '../../lib/salesOrderStatus';
import { deliveryStatusLabel } from '../../lib/outboundStatus';
import SalesOrderLinesTable from './SalesOrderLinesTable';
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
  TotalCards,
  expandableRowClass,
  stickyActionsCellClass,
} from '../../components/ListView';

// Sales Orders open on this status by default; the user can still change it.
const DEFAULT_STATUS = 'Pending Fulfillment';
/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/**
 * Without an item filter an open row shows at most this many lines and then
 * points at the detail page for the rest — one order carries 500 lines.
 */
const LINE_PREVIEW = 10;

type FieldKind = 'text' | 'date' | 'delivery_status';

interface FieldDef {
  value: SalesOrderFilterField;
  label: string;
  kind: FieldKind;
  /** Matched against the order's lines rather than its header. */
  item?: true;
}

/**
 * The shared list/tracking filter habit: the three fields used most sit above
 * the table and search as they change; the rest live behind "Additional
 * filters" and count once applied.
 */
const PRIMARY_FIELDS: FieldDef[] = [
  { value: 'material_code', label: 'Part Number', kind: 'text', item: true },
  { value: 'warehouse_name', label: 'Warehouse', kind: 'text' },
  { value: 'created_at', label: 'Created Date', kind: 'date' },
];

/** The SO Tracking board's other columns, one field each. */
const EXTRA_FIELDS: FieldDef[] = [
  { value: 'tran_id', label: 'Transaction ID', kind: 'text' },
  { value: 'oracle_id', label: 'ERP Doc ID', kind: 'text' },
  { value: 'customer_name', label: 'Customer', kind: 'text' },
  { value: 'delivery_status', label: 'Delivery Status', kind: 'delivery_status' },
  { value: 'memo', label: 'Memo', kind: 'text' },
  { value: 'material_name', label: 'Material Name', kind: 'text', item: true },
  { value: 'item_name', label: 'Item Name', kind: 'text', item: true },
  { value: 'item_description', label: 'Item Description', kind: 'text', item: true },
];

const ITEM_FIELDS = new Set<SalesOrderFilterField>(
  [...PRIMARY_FIELDS, ...EXTRA_FIELDS].filter((f) => f.item).map((f) => f.value),
);

const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];

type Draft = Record<SalesOrderFilterField, string[]>;

function emptyDraft(): Draft {
  return Object.fromEntries(FILTER_FIELDS.map((f) => [f.value, []])) as unknown as Draft;
}

function draftFrom(filters: SalesOrderFilter[]): Draft {
  const d = emptyDraft();
  for (const f of filters) d[f.field] = f.values;
  return d;
}

function fieldLabel(f: SalesOrderFilterField) {
  return FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;
}

/** Filters live in the URL so a refresh or a shared link shows the same list. */
function readFilters(sp: URLSearchParams): SalesOrderFilter[] {
  const raw = sp.get('filters');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(FILTER_FIELDS.map((f) => f.value));
    return parsed.flatMap((f): SalesOrderFilter[] => {
      const field = (f as SalesOrderFilter)?.field;
      const values = (f as SalesOrderFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Does this line match one item filter? Mirrors the server: the filter's
 * values are OR-ed, so any one of them matching is enough.
 */
function itemMatches(it: SalesOrderItemRow, f: SalesOrderFilter): boolean {
  return f.values.some((raw) => {
    const v = raw.trim().toLowerCase();
    if (!v) return false;
    const has = (x: string | null) => !!x && x.toLowerCase().includes(v);
    switch (f.field) {
      case 'material_code':
        // The server also matches the Oracle item name, which carries the code
        // for lines never linked to a material.
        return has(it.material_code) || has(it.item_name);
      case 'material_name':
        return has(it.material_name);
      case 'item_name':
        return has(it.item_name);
      case 'item_description':
        return has(it.description);
      default:
        return true;
    }
  });
}

/** "2026-10-23 14:20", as on the other outbound lists. */
function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** expand, No, 11 data columns, Actions. */
const COLS = 14;

/** Line quantities summed over every order matching the filters (Available Qty excluded). */
interface Totals {
  request_qty: number;
  given_qty: number;
  remaining_qty: number;
  actual_delivery: number;
}

/**
 * Sales Order list, laid out like the other tracking lists (the SO Tracking
 * board's filters, with each order opening on its lines) and searched from the
 * start rather than from an empty board.
 */
export default function SalesOrderList() {
  const defaultStatus = DEFAULT_STATUS;
  const statusOptions = SO_STATUSES;
  const cols = COLS;
  const { has } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canSync = has('sales-orders:sync');

  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => ({
    filters: readFilters(searchParams),
    status: searchParams.get('status') ?? defaultStatus,
  }));

  const [data, setData] = useState<(Paginated<SalesOrderRow> & { totals?: Totals }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState(initial.status);
  const [reloadKey, setReloadKey] = useState(0);

  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<SalesOrderFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);

  // Every order's lines are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  const [syncOpen, setSyncOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncLoading, setLastSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncResult, setSyncResult] = useState<SalesOrderSyncResult | null>(null);

  const appliedKey = JSON.stringify(applied);
  const [exporting, setExporting] = useState(false);

  /**
   * Every SO the filters match (any status, with or without a delivery plan),
   * with its lines and delivery plans: requested, delivered, SD number, date.
   */
  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    toast.info('Preparing the export…');
    try {
      await downloadFile(
        '/sales-orders/export',
        { status: status || undefined, filters: applied.length ? appliedKey : undefined },
        'sales_order_delivery_export.xlsx',
      );
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Paginated<SalesOrderRow> & { totals?: Totals }>('/sales-orders', {
        params: {
          page,
          limit: pageSize,
          status: status || undefined,
          filters: applied.length ? JSON.stringify(applied) : undefined,
          include_items: 'true',
          ...params(),
        },
      });
      setData(r.data);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, status, appliedKey, sort.sortBy, sort.order, reloadKey]);

  // Keep the status and filters in the URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status !== defaultStatus) next.set('status', status);
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
      const r = await api.get<{ lastSyncAt: string | null }>('/sales-orders/erp-last-sync');
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
      const r = await api.post<SalesOrderSyncResult>('/sales-orders/sync-erp', payload);
      setSyncResult(r.data);
      setPage(1);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setSyncError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Sync failed');
      } else setSyncError('Sync failed');
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

  /** The three fields outside the modal search as soon as they change. */
  function changePrimary(field: SalesOrderFilterField, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }

  /** The modal's fields as last applied — what a closed modal falls back to. */
  function appliedExtras(): Partial<Draft> {
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
    setDraft(emptyDraft());
    setApplied([]);
    setPage(1);
  }

  /** Ids / enum members are what travels; labels are what the user reads. */
  function valueLabel(field: SalesOrderFilterField, value: string) {
    if (field === 'created_at') return formatRangeValue(value);
    if (field === 'delivery_status') return deliveryStatusLabel(value);
    return value;
  }

  const extraCount = applied.filter((f) => EXTRA_FIELDS.some((x) => x.value === f.field)).length;

  function renderField(f: FieldDef, onChange: (v: string[]) => void) {
    const values = draft[f.value] ?? [];
    if (f.kind === 'date') {
      return <DateRangeInput value={values[0] ?? ''} onChange={(v) => onChange(v ? [v] : [])} />;
    }
    if (f.kind === 'delivery_status') {
      return (
        <MultiValueSelect
          values={values}
          onChange={onChange}
          max={MAX_VALUES}
          placeholder="Select delivery status…"
          searchPlaceholder="Search…"
          // The enum has exactly these two members.
          options={['Open', 'ProgressPicking'].map((o) => ({ value: o, label: deliveryStatusLabel(o) }))}
        />
      );
    }
    return (
      <MultiValueInput
        values={values}
        onChange={onChange}
        max={MAX_VALUES}
        placeholder={`${f.label} — type and press Enter…`}
      />
    );
  }

  // ----- accordion -----

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const anyOpen = rows.some((r) => !collapsed.has(r.id));
  // Item filters in force — they decide which lines an open order shows.
  const partFilters = applied.filter((f) => ITEM_FIELDS.has(f.field));

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

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Sales Order"
          subtitle="Initiate a delivery request for customer orders"
          menu={[{ label: exporting ? 'Exporting…' : 'Export', icon: <ExportIcon />, onClick: exportExcel }]}
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
            value: f.values.map((v) => valueLabel(f.field, v)).join(' or '),
          }))}
          chipsNote={partFilters.length > 0 ? 'open orders show only the matching items' : undefined}
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
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
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

      {/* Totals over every matching order, not only this page — as on the Inventory List. */}
      {data?.totals && (
        <TotalCards
          items={[
            ['Request Qty', data.totals.request_qty],
            ['Given Qty', data.totals.given_qty],
            ['Remaining Qty', data.totals.remaining_qty],
            ['Actual Delivery', data.totals.actual_delivery],
          ]}
        />
      )}

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr className="[&>th]:font-medium [&_button]:normal-case [&_button]:tracking-normal">
                <th className="w-10 px-2 py-3" aria-label="Expand" />
                <th className="px-4 py-3 font-medium">No</th>
                <SortableTh label="Status" col="status_name" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Transaction ID" col="tran_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="ERP Doc ID" col="oracle_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Doc Type</th>
                <SortableTh label="Ownership" col="ownership" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Warehouse Name" col="location" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Customer Name" col="customer_name" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Created At" col="created_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Last Modified By</th>
                <SortableTh label="Last Modified At" col="last_modified" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={cols} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((t, i) => {
                  const open = !collapsed.has(t.id);
                  const all = t.items ?? [];
                  const matching = partFilters.length
                    ? all.filter((l) => partFilters.every((f) => itemMatches(l, f)))
                    : all;
                  // An item filter shows every match; otherwise only the first few.
                  const lines = partFilters.length ? matching : matching.slice(0, LINE_PREVIEW);
                  const detailPath = `/admin/outbound/sales-order/list/${t.id}`;
                  return [
                    <tr key={t.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(t.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(t.id)} noun="items" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(
                            t.status_name,
                          )}`}
                        >
                          {t.status_name ?? '-'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-800">{t.tran_id ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{t.oracle_id}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">Sales Order</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{t.ownership ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{t.warehouse?.name ?? t.location_name ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{t.customer_name ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{t.created_by ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(t.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{t.last_modified_by ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(t.last_modified)}</td>
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          actions={[
                            {
                              label: 'Detail',
                              icon: <DetailIcon />,
                              onClick: () => navigate(detailPath),
                            },
                          ]}
                        />
                      </td>
                    </tr>,

                    open && (
                      <AccordionPanelRow
                        key={`${t.id}-lines`}
                        colSpan={cols}
                        title="Material List"
                        noun="items"
                        total={all.length}
                        matching={matching.length}
                        filtered={partFilters.length > 0}
                        shown={lines.length}
                        detailPath={detailPath}
                      >
                        <SalesOrderLinesTable
                          lines={lines}
                          emptyText={
                            partFilters.length ? 'No item on this order matches the item filter.' : 'This order has no items.'
                          }
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={cols} className="px-6 py-10 text-center text-slate-400">
                    {applied.length > 0 || status
                      ? 'No sales order matches the filters.'
                      : 'No sales orders. Click the refresh button to pull data from ERP.'}
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

      <Modal
        open={syncOpen}
        title="Sync Sales Orders from ERP"
        onClose={() => (syncing ? null : setSyncOpen(false))}
      >
        <form onSubmit={handleSync} className="space-y-4">
          {syncError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {syncError}
            </div>
          )}
          <p className="text-sm text-slate-500">
            Pull all sales orders from Oracle. Incremental by last modified;
            existing orders are updated in place.
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            {lastSyncLoading ? (
              <span className="text-slate-400">Checking last sync time…</span>
            ) : lastSyncAt ? (
              <>
                <div className="text-slate-500">Last sync (created_at)</div>
                <div className="font-medium text-slate-800">
                  {new Date(lastSyncAt).toLocaleString()}
                </div>
              </>
            ) : (
              <div className="font-medium text-slate-800">
                No previous sync — a full sync will run.
              </div>
            )}
          </div>
          {syncResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="font-medium">
                {syncResult.fullSync ? 'Full sync' : 'Incremental sync'} complete
              </div>
              <ul className="mt-1 space-y-0.5 text-emerald-700">
                <li>Total records: {syncResult.totalRecords}</li>
                <li>Upserted: {syncResult.upserted}</li>
                <li>Failed: {syncResult.failed}</li>
                <li>Duration: {(syncResult.durationMs / 1000).toFixed(1)}s</li>
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSyncOpen(false)}
              disabled={syncing}
            >
              {syncResult ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={syncing || lastSyncLoading}
            >
              {syncing ? 'Syncing…' : 'Start sync'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
