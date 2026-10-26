import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import type {
  Paginated,
  SalesOrderDetail,
  SalesOrderFilter,
  SalesOrderFilterField,
  SalesOrderItemRow,
  SalesOrderRow,
} from '../../types';
import { deliveryStatusLabel } from '../../lib/outboundStatus';
import { soStatusBadgeClass } from '../../lib/salesOrderStatus';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';
import MultiValueInput from '../../components/MultiValueInput';
import MultiValueSelect from '../../components/MultiValueSelect';
import Modal from '../../components/Modal';
import RowActionMenu from '../../components/RowActionMenu';
import TablePager from '../../components/TablePager';
import DateRangeInput, { formatRangeValue } from '../../components/DateRangeInput';

/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/** Table columns (expand, No, 12 data, Actions) — for the full-width rows. */
const COLS = 15;
/**
 * Without an item filter an expanded order shows at most this many lines and
 * then points at the detail page — one order carries 500 lines.
 */
const ITEM_PREVIEW = 10;

type FieldDef = { value: SalesOrderFilterField; label: string; item?: true };

/**
 * Every column is laid out as its own field. The three searched most sit above
 * the table; the rest live behind "Additional filters" so the bar stays short
 * without hiding anything.
 */
const PRIMARY_FIELDS: FieldDef[] = [
  { value: 'material_code', label: 'Item · PN / Material Code', item: true },
  { value: 'warehouse_name', label: 'Warehouse' },
  { value: 'status_name', label: 'Status' },
];

const EXTRA_FIELDS: FieldDef[] = [
  { value: 'tran_id', label: 'SO Number' },
  { value: 'oracle_id', label: 'Oracle ID' },
  { value: 'customer_name', label: 'Customer' },
  { value: 'delivery_status', label: 'Delivery Status' },
  { value: 'memo', label: 'Memo' },
  { value: 'created_at', label: 'Created Date' },
  { value: 'material_name', label: 'Item · Material Name', item: true },
  { value: 'item_name', label: 'Item · Item Name', item: true },
  { value: 'item_description', label: 'Item · Description', item: true },
];

const FILTER_FIELDS: FieldDef[] = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];

/** A blank value for every column; the form always holds all of them. */
function emptyDraft(): Record<SalesOrderFilterField, string[]> {
  return FILTER_FIELDS.reduce(
    (acc, f) => ({ ...acc, [f.value]: [] }),
    {} as Record<SalesOrderFilterField, string[]>,
  );
}

/**
 * The search lives in the URL, so a refresh (or a shared link) restores the
 * same view instead of resetting to the empty board.
 */
function readFilters(sp: URLSearchParams): SalesOrderFilter[] {
  const raw = sp.get('filters');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(FILTER_FIELDS.map((f) => f.value));
    // A hand-edited URL must not be able to break the page.
    return parsed.flatMap((f): SalesOrderFilter[] => {
      const field = (f as SalesOrderFilter)?.field;
      const values = (f as SalesOrderFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter(
        (v): v is string => typeof v === 'string' && !!v.trim(),
      );
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

function draftFrom(
  filters: SalesOrderFilter[],
): Record<SalesOrderFilterField, string[]> {
  const d = emptyDraft();
  for (const f of filters) d[f.field] = f.values;
  return d;
}

/** Columns whose value is a "from..to" date range instead of free text. */
const DATE_FIELDS = new Set<SalesOrderFilterField>(['created_at']);

const ITEM_FIELDS = new Set<SalesOrderFilterField>(
  FILTER_FIELDS.filter((f) => f.item).map((f) => f.value),
);

/** "2026-10-23 14:20", as on the Sales Order list. */
function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fieldLabel(f: SalesOrderFilterField) {
  return FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;
}

/**
 * Does this line match one item filter? Mirrors the server: the filter's values
 * are OR-ed, so any one of them matching is enough.
 */
function itemMatches(it: SalesOrderItemRow, f: SalesOrderFilter): boolean {
  return f.values.some((raw) => {
    const v = raw.trim().toLowerCase();
    if (!v) return false;
    const has = (s: string | null) => !!s && s.toLowerCase().includes(v);
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

/** Renders the right control for a column: dropdown, date range or chips. */
function FilterField({
  field,
  values,
  onChange,
  statuses,
}: {
  field: FieldDef;
  values: string[];
  onChange: (values: string[]) => void;
  statuses: string[];
}) {
  if (DATE_FIELDS.has(field.value)) {
    return (
      <DateRangeInput
        value={values[0] ?? ''}
        onChange={(v) => onChange(v ? [v] : [])}
      />
    );
  }
  if (field.value === 'status_name') {
    return (
      <MultiValueSelect
        values={values}
        onChange={onChange}
        max={MAX_VALUES}
        placeholder="Select status…"
        searchPlaceholder="Search status…"
        options={statuses.map((o) => ({ value: o, label: o }))}
      />
    );
  }
  if (field.value === 'delivery_status') {
    return (
      <MultiValueSelect
        values={values}
        onChange={onChange}
        max={MAX_VALUES}
        placeholder="Select delivery status…"
        searchPlaceholder="Search…"
        // The enum has exactly these two members.
        options={['Open', 'ProgressPicking'].map((o) => ({
          value: o,
          label: deliveryStatusLabel(o),
        }))}
      />
    );
  }
  return (
    <MultiValueInput
      values={values}
      onChange={onChange}
      max={MAX_VALUES}
      placeholder={`${field.label.replace('Item · ', '')} — type and press Enter…`}
    />
  );
}

/** Items of one order, fetched the first time its row is expanded. */
interface ItemState {
  loading: boolean;
  error: string;
  items: SalesOrderItemRow[];
}

/**
 * Sales Order tracking: a board that opens empty, is searched by column, and
 * shows each order's items under its row. Opened in its own tab from the Sales
 * Order list.
 *
 * Filters behave like Inventory Sales Tracking: the three fields outside the
 * modal search as soon as they change; the modal's fields only count once
 * Apply is pressed.
 */
export default function SalesOrderTrackingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once on mount; from then on the URL is written, not watched, so
  // typing in the form never re-reads it mid-edit.
  const [initial] = useState(() => {
    const filters = readFilters(searchParams);
    return {
      filters,
      // "searched" is marked explicitly: a search with every field empty is a
      // valid state that must survive a refresh too.
      searched: searchParams.get('searched') === '1',
      page: Math.max(1, Number(searchParams.get('page')) || 1),
      pageSize: [5, 10, 20, 50, 100].includes(Number(searchParams.get('limit')))
        ? Number(searchParams.get('limit'))
        : 10,
      sort: {
        sortBy: searchParams.get('sort_by'),
        order: (searchParams.get('sort_order') === 'desc' ? 'desc' : 'asc') as
          | 'asc'
          | 'desc',
      },
    };
  });

  const [data, setData] = useState<Paginated<SalesOrderRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  /**
   * The board starts empty on purpose: this page tracks a specific order, item
   * or warehouse, so nothing is fetched until a filter is filled in.
   */
  const [searched, setSearched] = useState(initial.searched);

  // Draft values are what the user edits; `applied` is what the server was
  // asked for. The modal's fields stay in the draft until Apply.
  const [draft, setDraft] = useState<Record<SalesOrderFilterField, string[]>>(
    () => draftFrom(initial.filters),
  );
  const [applied, setApplied] = useState<SalesOrderFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);
  const [statuses, setStatuses] = useState<string[]>([]);

  // Orders start collapsed; their lines are fetched on first expand.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemsById, setItemsById] = useState<Record<string, ItemState>>({});
  const { sort, toggle, params } = useSort(initial.sort);
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  const appliedKey = JSON.stringify(applied);

  const load = useCallback(async () => {
    if (!searched) return;
    setLoading(true);
    try {
      const r = await api.get<Paginated<SalesOrderRow>>('/sales-orders', {
        params: {
          page,
          limit: pageSize,
          filters: applied.length ? JSON.stringify(applied) : undefined,
          ...params(),
        },
      });
      setData(r.data);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, appliedKey, sort.sortBy, sort.order, searched]);

  useEffect(() => {
    load();
  }, [load]);

  // Mirror the search into the URL so a refresh restores it. Replace rather
  // than push, so Back still leaves the page.
  useEffect(() => {
    const next = new URLSearchParams();
    if (searched) {
      next.set('searched', '1');
      if (applied.length) next.set('filters', JSON.stringify(applied));
      if (page > 1) next.set('page', String(page));
      if (pageSize !== 10) next.set('limit', String(pageSize));
      if (sort.sortBy) {
        next.set('sort_by', sort.sortBy);
        next.set('sort_order', sort.order);
      }
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, appliedKey, page, pageSize, sort.sortBy, sort.order]);

  useEffect(() => {
    // The distinct statuses present in WMS, for the Status dropdown.
    api
      .get<{ statuses: string[] }>('/sales-orders/statuses')
      .then((r) => setStatuses(r.data.statuses))
      .catch(() => setStatuses([]));
  }, []);

  // A new result set invalidates every open row and its cached lines.
  useEffect(() => {
    setExpanded(new Set());
    setItemsById({});
  }, [page, pageSize, appliedKey, sort.sortBy, sort.order]);

  // Item filters currently in force — they drive what the accordion shows.
  const itemFilters = applied.filter((f) => ITEM_FIELDS.has(f.field));

  /**
   * Run the search for a set of field values. With nothing filled in the page
   * goes back to the empty board rather than listing every order.
   */
  function runSearch(values: Record<SalesOrderFilterField, string[]>) {
    const next = FILTER_FIELDS.map((f) => ({
      field: f.value,
      values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean),
    })).filter((f) => f.values.length);
    setPage(1);
    setApplied(next);
    if (next.length) {
      setSearched(true);
    } else {
      setSearched(false);
      setData(null);
    }
  }

  /** The three fields outside the modal search as soon as they change. */
  function changePrimary(field: SalesOrderFilterField, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }

  /** The modal's fields as last applied — what a closed modal falls back to. */
  function appliedExtras(): Partial<Record<SalesOrderFilterField, string[]>> {
    const fromApplied = draftFrom(applied);
    return Object.fromEntries(EXTRA_FIELDS.map((f) => [f.value, fromApplied[f.value] ?? []]));
  }

  /** Apply in the modal: its edits join the outside fields and search. */
  function applyExtras() {
    runSearch(draft);
    setExtraOpen(false);
  }

  /** Closing the modal without Apply drops its unapplied edits. */
  function closeExtras() {
    setDraft((d) => ({ ...d, ...appliedExtras() }));
    setExtraOpen(false);
  }

  /** Reset in the modal empties its fields; nothing is searched until Apply. */
  function resetExtras() {
    setDraft((d) => ({
      ...d,
      ...Object.fromEntries(EXTRA_FIELDS.map((f) => [f.value, []])),
    }));
  }

  function clearFilters() {
    setDraft(emptyDraft());
    setApplied([]);
    setPage(1);
    // Back to the empty board rather than the whole table.
    setSearched(false);
    setData(null);
  }

  function setValues(field: SalesOrderFilterField, values: string[]) {
    setDraft((d) => ({ ...d, [field]: values }));
  }

  /** Ids are what travels; names are what the user reads. */
  function valueLabel(field: SalesOrderFilterField, value: string): string {
    if (field === 'delivery_status') return deliveryStatusLabel(value);
    if (DATE_FIELDS.has(field)) return formatRangeValue(value);
    return value;
  }

  /** How many of the modal's fields are in force. */
  const extraCount = applied.filter((f) => EXTRA_FIELDS.some((x) => x.value === f.field)).length;

  /** Expand/collapse one order, fetching its lines the first time only. */
  async function toggleRow(id: string) {
    const isOpen = expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isOpen || itemsById[id]?.items) return;

    setItemsById((prev) => ({ ...prev, [id]: { loading: true, error: '', items: [] } }));
    try {
      const r = await api.get<SalesOrderDetail>(`/sales-orders/${id}`);
      setItemsById((prev) => ({
        ...prev,
        [id]: { loading: false, error: '', items: r.data.items ?? [] },
      }));
    } catch {
      setItemsById((prev) => ({
        ...prev,
        [id]: { loading: false, error: 'Could not load the items.', items: [] },
      }));
    }
  }

  const th = 'whitespace-nowrap';
  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/outbound/sales-order/list"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Sales Order list
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">SO Tracking</h1>
        <p className="mt-1 text-sm text-slate-500">
          {searched && data
            ? `${data.total_data} sales order(s) found`
            : 'Search by item, warehouse or status to track an order'}{' '}
          · click a row to see its items.
        </p>
      </div>

      {/* Every column has its own field; the three most used sit here and
          search as they change, the rest live in the "Additional filters"
          dialog and count once applied. All are AND-ed. */}
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Search
          </h3>
          <span className="text-xs text-slate-400">
            Searches as you change a field · all filled fields must match · several
            values in one field mean "any of these"
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRIMARY_FIELDS.map((f) => (
            <label key={f.value} className="block">
              <span className="mb-1 block text-xs text-slate-400">{f.label}</span>
              <FilterField
                field={f}
                values={draft[f.value] ?? []}
                onChange={(values) => changePrimary(f.value, values)}
                statuses={statuses}
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDraft((d) => ({ ...d, ...appliedExtras() }));
              setExtraOpen(true);
            }}
          >
            + Additional filters
            {extraCount > 0 && (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
                {extraCount}
              </span>
            )}
          </button>
          {(applied.length > 0 || searched) && (
            <button type="button" className="btn-secondary" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>

        {applied.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs">
            <span className="text-slate-400">Active:</span>
            {applied.map((f, i) => (
              <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                {fieldLabel(f.field)}:{' '}
                <b className="font-medium">
                  {f.values.map((v) => valueLabel(f.field, v)).join(' or ')}
                </b>
              </span>
            ))}
            {itemFilters.length > 0 && (
              <span className="text-slate-400">
                · expanded orders show only the matching items
              </span>
            )}
          </div>
        )}
      </div>

      {/* The remaining columns, one field each. Nothing here searches until
          Apply, which runs them together with the fields above. */}
      <Modal
        open={extraOpen}
        title="Additional filters"
        onClose={closeExtras}
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            These narrow the result together with the fields above. Several values in
            one field mean "any of these".
          </p>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {EXTRA_FIELDS.map((f) => (
              <label key={f.value} className="block">
                <span className="mb-1 block text-xs text-slate-400">{f.label}</span>
                <FilterField
                  field={f}
                  values={draft[f.value] ?? []}
                  onChange={(values) => setValues(f.value, values)}
                  statuses={statuses}
                />
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" className="btn-secondary" onClick={resetExtras}>
              Reset
            </button>
            <button type="button" className="btn-primary" onClick={applyExtras}>
              Apply
            </button>
          </div>
        </div>
      </Modal>

      <div className="card overflow-hidden">
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
              {!searched ? (
                <tr>
                  <td colSpan={COLS} className="px-6 py-16 text-center">
                    <div className="text-sm font-medium text-slate-500">Nothing loaded yet</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Fill one or more filters above to track an order, an item or a
                      warehouse.
                    </div>
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((s, idx) => {
                  const open = expanded.has(s.id);
                  const state = itemsById[s.id];
                  // With an item filter in force the panel shows only the
                  // matching lines; otherwise it previews the first few and
                  // sends the user to the detail page for the rest.
                  const all = state?.items ?? [];
                  const matching = itemFilters.length
                    ? all.filter((it) => itemFilters.every((f) => itemMatches(it, f)))
                    : all;
                  const capped = itemFilters.length ? matching : matching.slice(0, ITEM_PREVIEW);
                  const hidden = matching.length - capped.length;
                  return [
                    <tr
                      key={s.id}
                      className={`group cursor-pointer ${
                        open ? 'bg-brand-50/70 hover:bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => toggleRow(s.id)}
                    >
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          aria-expanded={open}
                          aria-label={open ? 'Collapse items' : 'Expand items'}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(s.id);
                          }}
                        >
                          <svg
                            className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + idx + 1}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(
                            s.status_name,
                          )}`}
                        >
                          {s.status_name ?? '-'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-800">{s.tran_id ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.oracle_id}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">Sales Order</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.ownership ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{s.warehouse?.name ?? s.location_name ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{s.customer_name ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.created_by ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(s.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.last_modified_by ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(s.last_modified)}</td>
                      <td
                        className={`sticky right-0 px-4 py-3 text-center shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)] ${
                          open ? 'bg-brand-50' : 'bg-white group-hover:bg-slate-50'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RowActionMenu
                          actions={[
                            {
                              label: 'Detail',
                              onClick: () => navigate(`/admin/outbound/sales-order/list/${s.id}`),
                            },
                          ]}
                        />
                      </td>
                    </tr>,

                    open && (
                      <tr key={`${s.id}-items`} className="bg-brand-50/70">
                        <td colSpan={COLS} className="border-l-4 border-brand-400 px-5 py-3">
                          {state?.loading ? (
                            <div className="py-3 text-center text-xs text-slate-400">Loading items…</div>
                          ) : state?.error ? (
                            <div className="py-3 text-center text-xs text-rose-600">{state.error}</div>
                          ) : matching.length === 0 ? (
                            <div className="rounded-lg border border-brand-200 bg-white py-3 text-center text-xs text-slate-400">
                              {itemFilters.length
                                ? 'No item on this order matches the item filter.'
                                : 'This order has no items.'}
                            </div>
                          ) : (
                            // Sticks to the left edge so the items stay in view while
                            // the wide order table scrolls sideways.
                            <div className="sticky left-5 max-w-[calc(100vw-22rem)] overflow-hidden rounded-lg border border-brand-200 bg-white shadow-sm">
                              <div className="flex items-center justify-between gap-3 border-b border-brand-200 bg-brand-100/70 px-4 py-1.5 text-xs font-semibold text-brand-800">
                                <span>
                                  Material List{' '}
                                  {itemFilters.length
                                    ? `· ${matching.length} matching of ${all.length}`
                                    : `· ${all.length}`}
                                </span>
                                {hidden > 0 && (
                                  <Link
                                    to={`/admin/outbound/sales-order/list/${s.id}`}
                                    className="font-medium text-brand-700 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {hidden} more — open detail →
                                  </Link>
                                )}
                              </div>
                              {/* Same columns as the detail page's Material List. */}
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-200 text-sm">
                                  <thead className="bg-slate-50 text-left text-slate-600">
                                    <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
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
                                    {capped.map((it, i) => (
                                      <tr key={it.id}>
                                        <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">
                                          {it.material_code ?? <span className="text-slate-300">unmatched</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-slate-700">
                                          {it.material_name ?? it.item_name ?? '-'}
                                        </td>
                                        <td className="px-4 py-2.5 text-slate-700">{it.uom ?? '-'}</td>
                                        <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.available_qty)}</td>
                                        <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.quantity)}</td>
                                        <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.given_qty)}</td>
                                        <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.remaining_qty)}</td>
                                        <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.actual_delivery)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {hidden > 0 && (
                                <div className="border-t border-brand-200 bg-brand-50/60 px-4 py-2 text-center text-[11px] text-slate-500">
                                  Showing the first {ITEM_PREVIEW} of {matching.length} items —{' '}
                                  <Link
                                    to={`/admin/outbound/sales-order/list/${s.id}`}
                                    className="font-medium text-brand-700 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    open the detail page
                                  </Link>{' '}
                                  to see them all.
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    No sales order matches every filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {searched && data && (
          <TablePager
            page={page}
            pageSize={pageSize}
            total={data.total_data}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        )}
      </div>
    </div>
  );
}
