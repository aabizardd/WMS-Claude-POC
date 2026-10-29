import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import type { IaFilter, IaFilterField, InventoryAdjustmentItemRow, InventoryAdjustmentRow, Paginated } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';
import MultiValueInput from '../../components/MultiValueInput';
import DateRangeInput, { formatRangeValue } from '../../components/DateRangeInput';
import TablePager from '../../components/TablePager';
import RowActionMenu from '../../components/RowActionMenu';
import { ExportIcon } from '../../components/ToolbarMenu';
import ColumnSettings, { useColumnVisibility } from '../../components/ColumnSettings';
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
} from '../../components/ListView';
import { AdjListLinesTable, AdjStatusPill, IA_STATUSES, SignedQty, adjTypeLabel } from './iaShared';


const BASE = '/admin/inventory-adjustments';
/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/** Without a material filter an open row shows at most this many lines. */
const LINE_PREVIEW = 10;

type FieldKind = 'text' | 'date';
interface FieldDef {
  value: IaFilterField;
  label: string;
  kind: FieldKind;
}

/** The list/tracking filter habit: three fields above the table, the rest in "Additional filters". */
const PRIMARY_FIELDS: FieldDef[] = [
  { value: 'material_code', label: 'Part Number', kind: 'text' },
  { value: 'warehouse', label: 'Warehouse', kind: 'text' },
  { value: 'created_at', label: 'Created At', kind: 'date' },
];
const EXTRA_FIELDS: FieldDef[] = [
  { value: 'bin', label: 'Bin', kind: 'text' },
  { value: 'material_name', label: 'Material Name', kind: 'text' },
  { value: 'type', label: 'Type', kind: 'text' },
  { value: 'created_by', label: 'Created By', kind: 'text' },
];
const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];

type Draft = Record<IaFilterField, string[]>;
const emptyDraft = (): Draft => Object.fromEntries(FILTER_FIELDS.map((f) => [f.value, []])) as unknown as Draft;
function draftFrom(filters: IaFilter[]): Draft {
  const d = emptyDraft();
  for (const f of filters) d[f.field] = f.values;
  return d;
}
const fieldLabel = (f: IaFilterField) => FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;

/** Filters live in the URL so a refresh or a shared link shows the same list. */
function readFilters(sp: URLSearchParams): IaFilter[] {
  const raw = sp.get('filters');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(FILTER_FIELDS.map((f) => f.value));
    return parsed.flatMap((f): IaFilter[] => {
      const field = (f as IaFilter)?.field;
      const values = (f as IaFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

/** Does this line match a Part Number / Material Name / Bin filter? Mirrors the server. */
function lineMatches(l: InventoryAdjustmentItemRow, f: IaFilter) {
  const hay =
    f.field === 'material_code'
      ? `${l.material_code ?? ''}`
      : f.field === 'material_name'
        ? `${l.material_name ?? ''}`
        : `${l.bin_code ?? ''} ${l.bin_label ?? ''}`;
  return f.values.some((raw) => !!raw.trim() && hay.toLowerCase().includes(raw.trim().toLowerCase()));
}
// A row is already one warehouse, so only these narrow its lines.
const LINE_FIELDS: IaFilterField[] = ['material_code', 'material_name', 'bin'];

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const COLUMNS = [
  { key: 'status', label: 'Status' },
  { key: 'adjustment_number', label: 'Adjustment ID' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'type', label: 'Type' },
  { key: 'bins', label: 'Bins' },
  { key: 'total', label: 'Total Adjustment' },
  { key: 'class', label: 'Class' },
  { key: 'department', label: 'Department' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'created_by', label: 'Created By' },
  { key: 'created_at', label: 'Created At' },
];

/**
 * Inventory Adjustment list, laid out like the other tracking lists: one row
 * per document and warehouse, each opening on that warehouse's lines.
 */
export default function InventoryAdjustmentsPage() {
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const canCreate = has('inventory-adjustments:create');

  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => ({ filters: readFilters(searchParams), status: searchParams.get('status') ?? '' }));

  const [data, setData] = useState<Paginated<InventoryAdjustmentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState(initial.status);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<IaFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);
  // Every row's lines are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { visible, setVisible } = useColumnVisibility(
    'ia-list-columns',
    COLUMNS.map((c) => c.key),
  );
  const show = (k: string) => visible.includes(k);
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };
  const appliedKey = JSON.stringify(applied);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<InventoryAdjustmentRow>>('/inventory-adjustments', {
        params: {
          page,
          limit: pageSize,
          status: status || undefined,
          filters: applied.length ? JSON.stringify(applied) : undefined,
          ...params(),
        },
      })
      .then((r) => !cancelled && setData(r.data))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, status, appliedKey, sort.sortBy, sort.order, reloadKey]);

  // Keep the status and filters in the URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (applied.length) next.set('filters', JSON.stringify(applied));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, appliedKey]);

  // ----- filters -----
  function runSearch(values: Draft) {
    const next = FILTER_FIELDS.map((f) => ({
      field: f.value,
      values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean),
    })).filter((f) => f.values.length);
    setPage(1);
    setApplied(next);
  }
  function changePrimary(field: IaFilterField, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }
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
    setStatus('');
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
  const lineFilters = applied.filter((f) => LINE_FIELDS.includes(f.field));
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

  // expand + No + visible data columns + Actions
  const colCount = 3 + visible.length;
  const th = 'whitespace-nowrap';
  const td = 'whitespace-nowrap px-4 py-3 text-slate-700';

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Inventory Adjustment"
          subtitle="Manage stock adjustments, resolve discrepancies, and track approval status"
          menu={[{ label: 'Export', icon: <ExportIcon />, onClick: () => toast.info('Export is not available yet.') }]}
          actions={
            canCreate && (
              <Link to={`${BASE}/new`} className="btn-primary">
                + Create Adjustment
              </Link>
            )
          }
        />

        <ListFilterPanel
          columns={4}
          extraCount={extraCount}
          onOpenExtras={() => {
            setDraft((d) => ({ ...d, ...appliedExtras() }));
            setExtraOpen(true);
          }}
          onClear={applied.length > 0 || status ? clearAll : undefined}
          chips={applied.map((f) => ({
            label: fieldLabel(f.field),
            value: f.values.map((v) => (f.field === 'created_at' ? formatRangeValue(v) : v)).join(' or '),
          }))}
          chipsNote={lineFilters.length > 0 ? 'open rows show only the matching lines' : undefined}
          toolbar={
            <>
              <ExpandAllButton anyOpen={anyOpen} onClick={toggleAll} disabled={rows.length === 0} />
              <ColumnSettings columns={COLUMNS} visible={visible} onApply={setVisible} />
              <RefreshButton onClick={() => setReloadKey((k) => k + 1)} spinning={loading} title="Refresh" />
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
              {IA_STATUSES.map(([v, l]) => (
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
                {show('status') && <SortableTh label="Status" col="status" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('adjustment_number') && (
                  <SortableTh label="Adjustment ID" col="adjustment_number" sort={sort} onSort={onSort} pad="px-4" className={th} />
                )}
                {show('warehouse') && <SortableTh label="Warehouse" col="warehouse" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('type') && <SortableTh label="Type" col="adjustment_type" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('bins') && <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Bins</th>}
                {show('total') && <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Total Adjustment</th>}
                {show('class') && <SortableTh label="Class" col="class" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('department') && <SortableTh label="Department" col="department" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('ownership') && <SortableTh label="Ownership" col="ownership" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('created_by') && <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} pad="px-4" className={th} />}
                {show('created_at') && <SortableTh label="Created At" col="created_at" sort={sort} onSort={onSort} pad="px-4" className={th} />}
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
                rows.map((a, i) => {
                  const open = !collapsed.has(a.id);
                  const all = a.items ?? [];
                  const matching = lineFilters.length ? all.filter((l) => lineFilters.every((f) => lineMatches(l, f))) : all;
                  const lines = lineFilters.length ? matching : matching.slice(0, LINE_PREVIEW);
                  const detailPath = `${BASE}/${a.adjustment_id}`;
                  return [
                    <tr key={a.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(a.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(a.id)} noun="lines" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      {show('status') && (
                        <td className="px-4 py-3">
                          <AdjStatusPill status={a.status} />
                        </td>
                      )}
                      {show('adjustment_number') && <td className={`${td} text-slate-800`}>{a.adjustment_number}</td>}
                      {show('warehouse') && (
                        <td className="px-4 py-3 text-slate-700">
                          <div className="whitespace-nowrap">{a.warehouse ?? '-'}</div>
                          {a.warehouse_count > 1 && (
                            <span
                              className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                              title={`This document spans ${a.warehouse_count} warehouses; each is listed as its own row`}
                            >
                              1 of {a.warehouse_count} warehouses
                            </span>
                          )}
                        </td>
                      )}
                      {show('type') && <td className={td}>{adjTypeLabel(a.adjustment_type)}</td>}
                      {show('bins') && <td className={`${td} text-right text-slate-800`}>{a.bin_count}</td>}
                      {show('total') && (
                        <td className={`${td} text-right`}>
                          <SignedQty value={a.total_qty} className="font-medium" />
                        </td>
                      )}
                      {show('class') && <td className={td}>{a.class_name ?? '-'}</td>}
                      {show('department') && <td className={td}>{a.department_name ?? '-'}</td>}
                      {show('ownership') && <td className={td}>{a.ownership ?? '-'}</td>}
                      {show('created_by') && <td className={td}>{a.created_by ?? '-'}</td>}
                      {show('created_at') && <td className={td}>{formatDateTime(a.created_at)}</td>}
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu actions={[{ label: 'Detail', icon: <DetailIcon />, onClick: () => navigate(detailPath) }]} />
                      </td>
                    </tr>,
                    open && (
                      <AccordionPanelRow
                        key={`${a.id}-lines`}
                        colSpan={colCount}
                        title="Line items"
                        noun="lines"
                        total={all.length}
                        matching={matching.length}
                        filtered={lineFilters.length > 0}
                        shown={lines.length}
                        detailPath={detailPath}
                      >
                        <AdjListLinesTable
                          lines={lines}
                          qualityMode={a.adjustment_type === 'QualityAdjustment'}
                          emptyText={lineFilters.length ? 'No line on this adjustment matches the filters.' : undefined}
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    {applied.length > 0 || status ? 'No adjustment matches the filters.' : 'No adjustments yet.'}
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
