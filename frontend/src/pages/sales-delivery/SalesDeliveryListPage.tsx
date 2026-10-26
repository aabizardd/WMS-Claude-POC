import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import type {
  Paginated,
  SalesDeliveryFilter,
  SalesDeliveryFilterField,
  SalesDeliveryItem,
  SalesDeliveryRow,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useSort } from '../../hooks/useSort';
import RowActionMenu from '../../components/RowActionMenu';
import TablePager from '../../components/TablePager';
import MultiValueInput from '../../components/MultiValueInput';
import MultiValueSelect from '../../components/MultiValueSelect';
import DateRangeInput, { formatRangeValue } from '../../components/DateRangeInput';
import {
  ColumnSettings,
  SalesHeaderCells,
  SalesRowCells,
  useSalesColumns,
} from './salesColumns';
import SalesItemsTable from './SalesItemsTable';
import { useToast } from '../../context/ToastContext';
import { ExportIcon } from '../../components/ToolbarMenu';
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

/**
 * The Delivery / Return toggle. Deliveries are the default; returns live in the
 * URL (?type=return) so coming back from a detail page lands on the same view.
 */
type DocTypeView = 'delivery' | 'return';
const DOC_TYPE_VIEWS: { value: DocTypeView; label: string }[] = [
  { value: 'delivery', label: 'Sales Delivery' },
  { value: 'return', label: 'Sales Return' },
];
const DOC_TYPE_PARAM: Record<DocTypeView, 'SalesDelivery' | 'SalesReturn'> = {
  delivery: 'SalesDelivery',
  return: 'SalesReturn',
};
const DOC_TYPE_NOUN: Record<DocTypeView, string> = {
  delivery: 'sales delivery',
  return: 'sales return',
};

const SD_STATUS_LABELS: Record<string, string> = {
  Success: 'Success',
  Failed: 'Failed',
};

export function sdStatusLabel(s: string) {
  return SD_STATUS_LABELS[s] ?? s;
}

export function sdStatusBadge(s: string) {
  const map: Record<string, string> = {
    Success: 'bg-emerald-50 text-emerald-700',
    Failed: 'bg-rose-50 text-rose-700',
  };
  return map[s] ?? 'bg-slate-100 text-slate-600';
}

/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/**
 * Without an item filter an expanded document shows at most this many lines and
 * then points at the detail page.
 */
const ITEM_PREVIEW = 10;

type FieldKind = 'text' | 'date' | 'status';

interface FieldDef {
  value: SalesDeliveryFilterField;
  label: string;
  kind: FieldKind;
  /** Matched against the document's lines rather than its header. */
  item?: true;
}

/**
 * The three filters searched most sit above the table and search as soon as
 * they change; the rest live behind "Additional filters". The document type is
 * the SD / SR toggle, so it is not a filter here.
 */
const PRIMARY_FIELDS: FieldDef[] = [
  { value: 'material_code', label: 'Part Number', kind: 'text', item: true },
  { value: 'from_warehouse', label: 'Origin Warehouse', kind: 'text' },
  { value: 'created_at', label: 'Created At', kind: 'date' },
];

const EXTRA_FIELDS: FieldDef[] = [
  { value: 'bin', label: 'Bin', kind: 'text', item: true },
  { value: 'material_name', label: 'Material Name', kind: 'text', item: true },
  { value: 'delivery_number', label: 'SD/SR Number', kind: 'text' },
  { value: 'created_by', label: 'Created By', kind: 'text' },
  { value: 'status', label: 'Status', kind: 'status' },
];

const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];

const ITEM_FIELDS = new Set<SalesDeliveryFilterField>(
  FILTER_FIELDS.filter((f) => f.item).map((f) => f.value),
);

const STATUS_OPTIONS = [
  { value: 'Success', label: 'Success' },
  { value: 'Failed', label: 'Failed' },
];

function fieldLabel(f: SalesDeliveryFilterField) {
  return FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;
}

/** A blank value for every field; the form always holds all of them. */
function emptyDraft(): Record<string, string[]> {
  return FILTER_FIELDS.reduce((acc, f) => ({ ...acc, [f.value]: [] }), {} as Record<string, string[]>);
}

function draftFrom(filters: SalesDeliveryFilter[]): Record<string, string[]> {
  const d = emptyDraft();
  for (const f of filters) d[f.field] = f.values;
  return d;
}

/** Filters from the URL, so a refresh or a shared link restores the view. */
function readFilters(sp: URLSearchParams): SalesDeliveryFilter[] {
  const raw = sp.get('filters');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(FILTER_FIELDS.map((f) => f.value));
    // A hand-edited URL must not be able to break the page.
    return parsed.flatMap((f): SalesDeliveryFilter[] => {
      const field = (f as SalesDeliveryFilter)?.field;
      const values = (f as SalesDeliveryFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Does this line match one item filter? Mirrors the server: the filter's values
 * are OR-ed, so any one of them matching is enough.
 */
function itemMatches(it: SalesDeliveryItem, f: SalesDeliveryFilter): boolean {
  return f.values.some((raw) => {
    const v = raw.trim().toLowerCase();
    if (!v) return false;
    const has = (x: string | null) => !!x && x.toLowerCase().includes(v);
    switch (f.field) {
      case 'material_code':
        return has(it.material_code);
      case 'material_name':
        return has(it.material_name);
      case 'bin':
        return has(it.bin_label);
      default:
        return true;
    }
  });
}

/**
 * The tab an SD/SR Number filter points at: every value starting with "SR"
 * means returns, every one starting with "SD" means deliveries.
 */
function viewForNumbers(values: string[]): DocTypeView | null {
  const prefixes = new Set(values.map((v) => v.trim().slice(0, 2).toUpperCase()));
  if (prefixes.size !== 1) return null;
  if (prefixes.has('SR')) return 'return';
  if (prefixes.has('SD')) return 'delivery';
  return null;
}

/**
 * Inventory Sales: Sales Deliveries and Returns, one type at a time. Loads at
 * once with every row's items open, and is filtered the same way as the
 * Inventory and Transfer Order lists.
 */
export default function SalesDeliveryListPage() {
  const { has } = useAuth();
  const canCreate = has('sales-delivery:create');
  const navigate = useNavigate();
  const toast = useToast();
  const { visible: visibleColumns, setVisible: setVisibleColumns } = useSalesColumns();
  // Expand + No + the chosen columns + Actions.
  const colCount = visibleColumns.length + 3;

  const [searchParams, setSearchParams] = useSearchParams();
  // Read once on mount; from then on the URL is written, not watched.
  const [initial] = useState(() => ({
    filters: readFilters(searchParams),
    view: (searchParams.get('type') === 'return' ? 'return' : 'delivery') as DocTypeView,
    page: Math.max(1, Number(searchParams.get('page')) || 1),
    pageSize: [5, 10, 20, 50, 100].includes(Number(searchParams.get('limit')))
      ? Number(searchParams.get('limit'))
      : 10,
    sort: {
      sortBy: searchParams.get('sort_by'),
      order: (searchParams.get('sort_order') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
    },
  }));

  const [data, setData] = useState<(Paginated<SalesDeliveryRow> & { totals?: { qty: number } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [docView, setDocView] = useState<DocTypeView>(initial.view);
  /** Set when an SD/SR Number filter moved the user to the other tab, to say so. */
  const [switchedTo, setSwitchedTo] = useState<DocTypeView | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Draft values are what the user edits; `applied` is what the server was
  // asked for. Keeping them apart stops every keystroke from firing a request.
  const [draft, setDraft] = useState<Record<string, string[]>>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<SalesDeliveryFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);

  // Every document's items are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { sort, toggle, params } = useSort(initial.sort);
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  const appliedKey = JSON.stringify(applied);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Paginated<SalesDeliveryRow> & { totals?: { qty: number } }>('/sales-delivery', {
        params: {
          page,
          limit: pageSize,
          document_type: DOC_TYPE_PARAM[docView],
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
  }, [page, pageSize, docView, appliedKey, sort.sortBy, sort.order, reloadKey]);

  // Mirror the view into the URL so a refresh restores it. Replace rather than
  // push, so Back still leaves the page.
  useEffect(() => {
    const next = new URLSearchParams();
    if (docView === 'return') next.set('type', 'return');
    if (applied.length) next.set('filters', JSON.stringify(applied));
    if (page > 1) next.set('page', String(page));
    if (pageSize !== 10) next.set('limit', String(pageSize));
    if (sort.sortBy) {
      next.set('sort_by', sort.sortBy);
      next.set('sort_order', sort.order);
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docView, appliedKey, page, pageSize, sort.sortBy, sort.order]);

  function changeDocView(v: DocTypeView) {
    setSwitchedTo(null);
    setPage(1);
    setDocView(v);
  }

  // Item filters currently in force — they drive what the accordion shows.
  const itemFilters = applied.filter((f) => ITEM_FIELDS.has(f.field));

  /** Search with a set of field values (empty fields are dropped). */
  function runSearch(values: Record<string, string[]>) {
    const next = FILTER_FIELDS.map((f) => ({
      field: f.value,
      values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean),
    })).filter((f) => f.values.length);
    setPage(1);
    setApplied(next);
    // An SR number is looked for on Sales Return, an SD number on Sales Delivery.
    const numbers = next.find((f) => f.field === 'delivery_number')?.values ?? [];
    const target = viewForNumbers(numbers);
    if (target && target !== docView) {
      setDocView(target);
      setSwitchedTo(target);
    } else if (!numbers.length) {
      setSwitchedTo(null);
    }
  }

  /** The three fields outside the modal search as soon as they change. */
  function changePrimary(field: SalesDeliveryFilterField, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }

  /** The modal's fields as last applied — what a closed modal falls back to. */
  function appliedExtras(): Record<string, string[]> {
    const fromApplied = draftFrom(applied);
    return EXTRA_FIELDS.reduce(
      (acc, f) => ({ ...acc, [f.value]: fromApplied[f.value] ?? [] }),
      {} as Record<string, string[]>,
    );
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
      ...EXTRA_FIELDS.reduce((acc, f) => ({ ...acc, [f.value]: [] }), {}),
    }));
  }

  function clearFilters() {
    setDraft(emptyDraft());
    setApplied([]);
    setSwitchedTo(null);
    setPage(1);
  }

  function setValues(field: SalesDeliveryFilterField, values: string[]) {
    setDraft((d) => ({ ...d, [field]: values }));
  }

  /** Ids and enum values are what travels; names are what the user reads. */
  function valueLabel(field: SalesDeliveryFilterField, value: string): string {
    if (field === 'created_at') return formatRangeValue(value);
    return value;
  }

  /** How many of the modal's fields are in force. */
  const extraCount = applied.filter((f) => EXTRA_FIELDS.some((x) => x.value === f.field)).length;

  /** One input for one field, by kind. */
  function renderField(f: FieldDef) {
    const values = draft[f.value] ?? [];
    const isPrimary = PRIMARY_FIELDS.some((x) => x.value === f.value);
    const onChange = (v: string[]) =>
      isPrimary ? changePrimary(f.value, v) : setValues(f.value, v);
    const select = (options: { value: string; label: string }[], placeholder: string) => (
      <MultiValueSelect
        values={values}
        onChange={onChange}
        max={MAX_VALUES}
        placeholder={placeholder}
        searchPlaceholder="Search…"
        options={options}
      />
    );
    switch (f.kind) {
      case 'date':
        return (
          <DateRangeInput value={values[0] ?? ''} onChange={(v) => onChange(v ? [v] : [])} />
        );
      case 'status':
        return select(STATUS_OPTIONS, 'Select status…');
      default:
        return (
          <MultiValueInput
            values={values}
            onChange={onChange}
            max={MAX_VALUES}
            placeholder={`${f.label} — type and press Enter…`}
          />
        );
    }
  }

  // ----- accordion -----

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const anyOpen = rows.some((r) => !collapsed.has(r.id));

  function toggleRow(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(anyOpen ? new Set(rows.map((r) => r.id)) : new Set());
  }

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Inventory Sales"
          subtitle="Stock transfer between the MSO and VHS warehouses"
          menu={[
            {
              label: 'Export',
              icon: <ExportIcon />,
              onClick: () => toast.info('Export is not available yet.'),
            },
          ]}
          actions={
            canCreate && (
              <Link to="/admin/inventory/sales-delivery/new" className="btn-primary">
                + Create Sales Delivery
              </Link>
            )
          }
        />

        {/* Delivery / Return toggle. */}
        <div
          role="tablist"
          aria-label="Document type"
          className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
        >
          {DOC_TYPE_VIEWS.map((v) => {
            const active = docView === v.value;
            return (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeDocView(v.value)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        <ListFilterPanel
          extraCount={extraCount}
          onOpenExtras={() => {
            setDraft((d) => ({ ...d, ...appliedExtras() }));
            setExtraOpen(true);
          }}
          onClear={applied.length > 0 ? clearFilters : undefined}
          chips={applied.map((f) => ({
            label: fieldLabel(f.field),
            value: f.values.map((v) => valueLabel(f.field, v)).join(' or '),
          }))}
          chipsNote={itemFilters.length > 0 ? 'open documents show only the matching items' : undefined}
          toolbar={
            <>
              <ExpandAllButton anyOpen={anyOpen} onClick={toggleAll} disabled={rows.length === 0} />
              <ColumnSettings
                visible={visibleColumns}
                onApply={setVisibleColumns}
                isReturn={docView === 'return'}
              />
              <RefreshButton onClick={() => setReloadKey((k) => k + 1)} spinning={loading} />
            </>
          }
          footer={
            switchedTo && (
              <p className="text-xs text-slate-500">
                Showing <b>{DOC_TYPE_VIEWS.find((v) => v.value === switchedTo)?.label}</b> for the
                SD/SR Number filter.
              </p>
            )
          }
        >
          {PRIMARY_FIELDS.map((f) => (
            <FilterField key={f.value} label={f.label}>
              {renderField(f)}
            </FilterField>
          ))}
        </ListFilterPanel>
      </div>

      {/* The remaining filters. Nothing here searches until Apply, which runs
          them together with the fields above. */}
      <ExtraFiltersModal open={extraOpen} onClose={closeExtras} onReset={resetExtras} onApply={applyExtras}>
        {EXTRA_FIELDS.map((f) => (
          <FilterField key={f.value} label={f.label}>
            {renderField(f)}
          </FilterField>
        ))}
      </ExtraFiltersModal>

      {/* Quantity moved by every matching document, as on the Inventory and TO lists. */}
      {data?.totals && (
        <TotalCards
          items={[[docView === 'return' ? 'Qty Returned' : 'Qty Transfer', data.totals.qty]]}
        />
      )}

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr className="[&>th]:font-medium [&_button]:normal-case [&_button]:tracking-normal">
                <th className="w-10 px-2 py-3" aria-label="Expand" />
                <th className="px-4 py-3 font-medium">No</th>
                <SalesHeaderCells
                  visible={visibleColumns}
                  isReturn={docView === 'return'}
                  sort={sort}
                  onSort={onSort}
                />
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((d, idx) => {
                  const open = !collapsed.has(d.id);
                  // With an item filter in force the panel shows only the
                  // matching lines; otherwise it previews the first few and
                  // sends the user to the detail page for the rest.
                  const all = d.items ?? [];
                  const matching = itemFilters.length
                    ? all.filter((it) => itemFilters.every((f) => itemMatches(it, f)))
                    : all;
                  const shown = itemFilters.length ? matching : matching.slice(0, ITEM_PREVIEW);
                  const detailPath = `/admin/inventory/sales-delivery/${d.id}`;
                  return [
                    <tr key={d.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(d.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(d.id)} noun="items" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + idx + 1}</td>
                      <SalesRowCells row={d} visible={visibleColumns} />
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          actions={[
                            {
                              label: 'Detail',
                              icon: <DetailIcon />,
                              onClick: () => navigate(detailPath),
                            },
                            // A return is raised from a delivery, never from another return.
                            ...(canCreate && d.document_type === 'SalesDelivery'
                              ? [
                                  {
                                    label: 'Sales Return',
                                    icon: <ReturnIcon />,
                                    onClick: () =>
                                      navigate(`/admin/inventory/sales-delivery/return/new?source=${d.id}`),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>,

                    open && (
                      <AccordionPanelRow
                        key={`${d.id}-items`}
                        colSpan={colCount}
                        title="Items"
                        noun="items"
                        total={all.length}
                        matching={matching.length}
                        filtered={itemFilters.length > 0}
                        shown={shown.length}
                        detailPath={detailPath}
                      >
                        <SalesItemsTable
                          items={shown}
                          isReturn={docView === 'return'}
                          emptyText={
                            itemFilters.length
                              ? 'No item on this document matches the item filter.'
                              : 'This document has no items.'
                          }
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    {applied.length > 0
                      ? `No ${DOC_TYPE_NOUN[docView]} matches the filters.`
                      : `No ${DOC_TYPE_NOUN[docView]} yet.`}
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
    </div>
  );
}

function ReturnIcon() {
  return (
    <svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4" />
    </svg>
  );
}
