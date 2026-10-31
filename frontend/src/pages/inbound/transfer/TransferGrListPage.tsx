import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../../lib/api';
import type { Paginated, TransferGrFilter, TransferGrFilterField, TransferGrListLine, TransferGrRow } from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../context/ConfirmContext';
import { useSort } from '../../../hooks/useSort';
import SortableTh from '../../../components/SortableTh';
import MultiValueInput from '../../../components/MultiValueInput';
import DateRangeInput, { formatRangeValue } from '../../../components/DateRangeInput';
import RowActionMenu from '../../../components/RowActionMenu';
import TablePager from '../../../components/TablePager';
import { ExportIcon } from '../../../components/ToolbarMenu';
import { TrashIcon } from '../../../components/icons';
import { DocStatusPill } from '../../../components/wms/DocKit';
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
} from '../../../components/ListView';
import TransferGrLinesTable from './TransferGrLinesTable';
import { deleteTransferDoc } from './transferInbound';
import { TRANSFER_IN, type InboundSource } from './inboundSource';
/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/** Without a material filter an open row shows at most this many lines. */
const LINE_PREVIEW = 10;

const STATUSES: [value: string, label: string][] = [
  ['Open', 'Open'],
  ['OnProgress', 'On Progress'],
  ['SyncFailed', 'Sync Failed'],
  ['Closed', 'Closed'],
];

type FieldKind = 'text' | 'date';
interface FieldDef {
  value: TransferGrFilterField;
  label: string;
  kind: FieldKind;
}

/**
 * The list/tracking filter habit: three fields above the table, the rest in
 * "Additional filters" — per inbound, as WMS dev lays each one out.
 */
const FIELDS: Record<InboundSource['code'], { primary: FieldDef[]; extra: FieldDef[] }> = {
  TO: {
    primary: [
      { value: 'material_code', label: 'Part Number', kind: 'text' },
      { value: 'origin_warehouse', label: 'Origin Warehouse', kind: 'text' },
      { value: 'created_at', label: 'Created Date', kind: 'date' },
    ],
    extra: [
      { value: 'material_name', label: 'Material Name', kind: 'text' },
      { value: 'transaction_id', label: 'Transaction ID', kind: 'text' },
      { value: 'destination_warehouse', label: 'Destination Warehouse', kind: 'text' },
      { value: 'erp_doc_id', label: 'ERP Doc ID', kind: 'text' },
      { value: 'created_by', label: 'Created By', kind: 'text' },
    ],
  },
  PO: {
    primary: [
      { value: 'material_code', label: 'Part Number', kind: 'text' },
      { value: 'warehouse', label: 'Warehouse', kind: 'text' },
      { value: 'created_at', label: 'Created Range', kind: 'date' },
    ],
    extra: [
      { value: 'material_name', label: 'Material Name', kind: 'text' },
      { value: 'transaction_id', label: 'Transaction ID', kind: 'text' },
      { value: 'erp_doc_id', label: 'ERP Doc ID', kind: 'text' },
    ],
  },
};

type Draft = Partial<Record<TransferGrFilterField, string[]>>;
function draftFrom(filters: TransferGrFilter[]): Draft {
  const d: Draft = {};
  for (const f of filters) d[f.field] = f.values;
  return d;
}

/** Filters live in the URL so a refresh or a shared link shows the same list. */
function readFilters(sp: URLSearchParams, fields: FieldDef[]): TransferGrFilter[] {
  const raw = sp.get('filters');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(fields.map((f) => f.value));
    return parsed.flatMap((f): TransferGrFilter[] => {
      const field = (f as TransferGrFilter)?.field;
      const values = (f as TransferGrFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

/** Does this line match a Part Number / Material Name filter? Mirrors the server. */
function lineMatches(l: TransferGrListLine, f: TransferGrFilter) {
  const hay = f.field === 'material_code' ? `${l.material_code ?? ''}` : `${l.material_name ?? ''}`;
  return f.values.some((raw) => !!raw.trim() && hay.toLowerCase().includes(raw.trim().toLowerCase()));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Totals {
  planned_qty: number;
  actual_qty: number;
  putaway_qty: number;
  remain_qty: number;
}

/**
 * Goods Receive - TO / PO: every GR of the inbound, each row opening on its
 * lines (material info and every qty bucket), filtered the same way as the
 * inbound's Request list.
 */
export default function TransferGrListPage({ source = TRANSFER_IN }: { source?: InboundSource } = {}) {
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isPo = source.code === 'PO';
  const BASE = source.base;
  const { primary: PRIMARY_FIELDS, extra: EXTRA_FIELDS } = FIELDS[source.code];
  const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];
  const fieldLabel = (f: TransferGrFilterField) => FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;
  // expand, No, data columns (PO has no Origin Warehouse), Actions.
  const COLS = isPo ? 13 : 14;

  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => ({
    filters: readFilters(searchParams, FILTER_FIELDS),
    status: searchParams.get('status') ?? '',
  }));

  const [data, setData] = useState<(Paginated<TransferGrRow> & { totals?: Totals }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState(initial.status);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<TransferGrFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);
  // Every GR's lines are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
      .get<Paginated<TransferGrRow> & { totals?: Totals }>(`${source.api}/goods-receive`, {
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

  // Keep the status and filters in the URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (applied.length) next.set('filters', JSON.stringify(applied));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, appliedKey]);

  // ----- filters (standard habit) -----
  function runSearch(values: Draft) {
    const next = FILTER_FIELDS.map((f) => ({
      field: f.value,
      values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean),
    })).filter((f) => f.values.length);
    setPage(1);
    setApplied(next);
  }
  function changePrimary(field: TransferGrFilterField, values: string[]) {
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
    setDraft({});
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
          title={`Goods Receive - ${source.code}`}
          subtitle={`Validate and receive goods into the system for ${source.noun}`}
          menu={[{ label: 'Export', icon: <ExportIcon />, onClick: () => toast.info('Export is not available yet.') }]}
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

      {/* Totals over every matching GR, not only this page. */}
      {data?.totals && (
        <TotalCards
          items={[
            ['Planned Qty', data.totals.planned_qty],
            ['Actual Qty', data.totals.actual_qty],
            ['Putaway Qty', data.totals.putaway_qty],
            ['Remain Qty', data.totals.remain_qty],
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
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Transaction ID" col="transaction_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="GR ID" col="gr_number" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">ERP Doc ID</th>
                {isPo && <th className="whitespace-nowrap px-4 py-3 font-medium">Document Type</th>}
                <th className="whitespace-nowrap px-4 py-3 font-medium">Ownership</th>
                {!isPo && <th className="whitespace-nowrap px-4 py-3 font-medium">Origin Warehouse</th>}
                <SortableTh
                  label={isPo ? 'Warehouse' : 'Destination Warehouse'}
                  col="warehouse"
                  sort={sort}
                  onSort={onSort}
                  pad="px-4"
                  className={th}
                />
                <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Created At" col="created_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Last Modified At" col="updated_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                {!isPo && <th className="whitespace-nowrap px-4 py-3 font-medium">Document Type</th>}
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
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
                rows.map((g, i) => {
                  const open = !collapsed.has(g.id);
                  const all = g.items ?? [];
                  const matching = lineFilters.length ? all.filter((l) => lineFilters.every((f) => lineMatches(l, f))) : all;
                  const lines = lineFilters.length ? matching : matching.slice(0, LINE_PREVIEW);
                  const detailPath = `${BASE}/goods-receive/${g.id}`;
                  return [
                    <tr key={g.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(g.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(g.id)} noun="lines" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="px-4 py-3">
                        <DocStatusPill status={g.status} />
                      </td>
                      <td className={`${td} text-slate-800`}>{g.transaction_id ?? '-'}</td>
                      <td className={`${td} text-slate-800`}>{g.gr_number}</td>
                      <td className={td}>{g.erp_doc_id ?? '-'}</td>
                      {isPo && <td className={td}>{g.document_type}</td>}
                      <td className={td}>{g.ownership ?? '-'}</td>
                      {!isPo && <td className="px-4 py-3 text-slate-700">{g.origin_warehouse ?? '-'}</td>}
                      <td className="px-4 py-3 text-slate-700">{g.warehouse ?? '-'}</td>
                      <td className={td}>{g.created_by ?? '-'}</td>
                      <td className={td}>{formatDateTime(g.created_at)}</td>
                      <td className={td}>{formatDateTime(g.updated_at)}</td>
                      {!isPo && <td className={td}>{g.document_type}</td>}
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          actions={[
                            { label: 'Detail', icon: <DetailIcon />, onClick: () => navigate(detailPath) },
                            ...(has('goods-receive:delete') && g.status === 'Open'
                              ? [
                                  {
                                    label: 'Delete',
                                    icon: <TrashIcon />,
                                    onClick: async () => {
                                      if (await deleteTransferDoc('gr', g.id, g.gr_number, confirm, toast, source))
                                        setReloadKey((k) => k + 1);
                                    },
                                  },
                                ]
                              : []),
                            { label: 'Request Detail', icon: <DetailIcon />, onClick: () => navigate(source.requestPath(g.to_id)) },
                          ]}
                        />
                      </td>
                    </tr>,
                    open && (
                      <AccordionPanelRow
                        key={`${g.id}-lines`}
                        colSpan={COLS}
                        title="Line items"
                        noun="lines"
                        total={all.length}
                        matching={matching.length}
                        filtered={lineFilters.length > 0}
                        shown={lines.length}
                        detailPath={detailPath}
                      >
                        <TransferGrLinesTable
                          lines={lines}
                          emptyText={lineFilters.length ? 'No line on this GR matches the material filter.' : undefined}
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={COLS} className="px-6 py-10 text-center text-slate-400">
                    {applied.length > 0 || status ? 'No Goods Receive matches the filters.' : 'No Goods Receive yet.'}
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
