import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import MultiValueInput from '../../components/MultiValueInput';
import TablePager from '../../components/TablePager';
import {
  AccordionPanelRow,
  ExpandAllButton,
  ExtraFiltersModal,
  FilterField,
  ListFilterPanel,
  ListHeader,
  RefreshButton,
  RowExpandCell,
  TotalCards,
  expandableRowClass,
} from '../../components/ListView';
import { soStatusBadgeClass } from '../../lib/salesOrderStatus';
import DocRefsCell, { type DocRef } from './DocRefsCell';
import type { QtySourceType } from './QtySourceLink';


interface DocumentRow {
  doc_type: 'SO' | 'TO';
  doc_id: string;
  doc_number: string | null;
  erp_doc_id: string | null;
  status: string | null;
  party: string | null;
  material_code: string | null;
  material_name: string | null;
  warehouse_name: string | null;
  pickings?: DocRef[];
  packings?: DocRef[];
  sds?: DocRef[];
  qty: number;
  qty_picking?: number;
  qty_packing?: number | null;
  packing_diff?: number;
  qty_delivered?: number;
  qty_received?: number;
  /** Document rows only: its materials (the accordion). */
  lines?: DocumentRow[];
}

interface DocumentsResponse {
  total_data: number;
  total_page: number;
  totals: {
    qty: number;
    qty_picking: number;
    qty_packing: number;
    packing_diff: number;
    qty_delivered: number;
    qty_received: number;
    documents: number;
    materials: number;
  };
  cancelled_qty: number;
  rows: DocumentRow[];
}

interface Filter {
  field: string;
  values: string[];
}

interface FieldDef {
  value: string;
  label: string;
}

/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;

/** Per page: three filters outside the modal, the rest inside (standard habit). */
const FIELDS: Record<QtySourceType, { primary: FieldDef[]; extra: FieldDef[] }> = {
  reserved: {
    primary: [
      { value: 'material_code', label: 'Part Number' },
      { value: 'warehouse', label: 'Warehouse' },
      { value: 'tran_id', label: 'Transaction ID' },
    ],
    extra: [
      { value: 'material_name', label: 'Material Name' },
      { value: 'erp_doc_id', label: 'ERP Doc ID' },
      { value: 'party', label: 'Customer / Destination' },
      { value: 'picking_id', label: 'Picking ID' },
      { value: 'packing_id', label: 'Packing ID' },
      // A dropdown (All / SO / TO), not free text.
      { value: 'doc_type', label: 'Document Type' },
    ],
  },
  'in-transit': {
    primary: [
      { value: 'material_code', label: 'Part Number' },
      { value: 'warehouse', label: 'Origin Warehouse' },
      { value: 'tran_id', label: 'Transaction ID' },
    ],
    extra: [
      { value: 'material_name', label: 'Material Name' },
      { value: 'party', label: 'Destination Warehouse' },
      { value: 'erp_doc_id', label: 'ERP Doc ID' },
      { value: 'sd_id', label: 'SD ID' },
      { value: 'packing_id', label: 'Packing ID' },
    ],
  },
};

const DOC_TYPE_OPTIONS = [
  { value: 'SO', label: 'Sales Order' },
  { value: 'TO', label: 'Transfer Order' },
];

const OUTBOUND_BASE: Record<'SO' | 'TO', string> = {
  SO: '/admin/outbound/sales-order',
  TO: '/admin/outbound/transfer-stock',
};

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();


/**
 * Every SO / TO document behind the Inventory List's total Reserved or In
 * Transit qty — one row per document, material and warehouse — with the
 * standard filters (several fields, several values each) and paging.
 */
export default function InventoryQtyDocumentsPage({ type }: { type: QtySourceType }) {
  const isReserved = type === 'reserved';
  const { primary: PRIMARY, extra: EXTRA } = FIELDS[type];
  const ALL = [...PRIMARY, ...EXTRA];
  const fieldLabel = (f: string) => ALL.find((x) => x.value === f)?.label ?? f;

  const [searchParams, setSearchParams] = useSearchParams();
  // Read once on mount; from then on the URL is written, not watched.
  const [initial] = useState(() => {
    try {
      const parsed: unknown = JSON.parse(searchParams.get('filters') ?? '[]');
      const known = new Set(ALL.map((f) => f.value));
      return Array.isArray(parsed)
        ? parsed.flatMap((f): Filter[] => {
            const field = (f as Filter)?.field;
            const values = (f as Filter)?.values;
            if (!known.has(field) || !Array.isArray(values)) return [];
            const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
            return clean.length ? [{ field, values: clean }] : [];
          })
        : [];
    } catch {
      return [];
    }
  });

  const emptyDraft = () => Object.fromEntries(ALL.map((f) => [f.value, [] as string[]]));
  const draftFrom = (filters: Filter[]) => {
    const d = emptyDraft();
    for (const f of filters) d[f.field] = f.values;
    return d;
  };

  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<Record<string, string[]>>(() => draftFrom(initial));
  const [applied, setApplied] = useState<Filter[]>(initial);
  const [extraOpen, setExtraOpen] = useState(false);
  const appliedKey = JSON.stringify(applied);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<DocumentsResponse>(`/inventory/qty-sources/${type}`, {
        params: { page, limit: pageSize, filters: applied.length ? appliedKey : undefined },
      })
      .then((r) => active && setData(r.data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, page, pageSize, appliedKey, reloadKey]);

  // Keep the filters in the URL so a refresh or a shared link restores them.
  useEffect(() => {
    const next = new URLSearchParams();
    if (applied.length) next.set('filters', appliedKey);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  function runSearch(values: Record<string, string[]>) {
    setPage(1);
    setApplied(
      ALL.map((f) => ({ field: f.value, values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean) })).filter(
        (f) => f.values.length,
      ),
    );
  }

  /** The three fields outside the modal search as soon as they change. */
  function changePrimary(field: string, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }

  /** The modal's fields as last applied — what a closed modal falls back to. */
  function appliedExtras() {
    const fromApplied = draftFrom(applied);
    return Object.fromEntries(EXTRA.map((f) => [f.value, fromApplied[f.value] ?? []]));
  }

  const extraCount = applied.filter((f) => EXTRA.some((x) => x.value === f.field)).length;
  const rows = data?.rows ?? [];
  const title = isReserved ? 'Reserved Quantity Documents' : 'In Transit Quantity Documents';
  // Expand + No + 8 document columns + the qty columns.
  const cols = isReserved ? 14 : 13;

  // Every document's materials are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const keys = rows.map((r) => `${r.doc_type}-${r.doc_id}`);
  const anyOpen = keys.some((k) => !collapsed.has(k));
  function toggleRow(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const docPath = (r: DocumentRow) =>
    isReserved ? `${OUTBOUND_BASE[r.doc_type]}/list/${r.doc_id}` : `/admin/inbound/transfer/to/${r.doc_id}`;

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title={title}
          subtitle={
            isReserved
              ? 'Sales Orders and Transfer Orders whose picking still holds stock. Reserved = Qty Picking − Packing Difference − qty already shipped.'
              : 'Transfer Orders shipped out and not received by the destination yet. In Transit = Qty Delivered (SD) − Qty Received (TO In).'
          }
        />

        <ListFilterPanel
          extraCount={extraCount}
          onOpenExtras={() => {
            setDraft((d) => ({ ...d, ...appliedExtras() }));
            setExtraOpen(true);
          }}
          onClear={
            applied.length > 0
              ? () => {
                  setDraft(emptyDraft());
                  setApplied([]);
                  setPage(1);
                }
              : undefined
          }
          chips={applied.map((f) => ({
            label: fieldLabel(f.field),
            value: f.values
              .map((v) => (f.field === 'doc_type' ? (DOC_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v) : v))
              .join(' or '),
          }))}
          toolbar={
            <>
              <ExpandAllButton
                anyOpen={anyOpen}
                onClick={() => setCollapsed(anyOpen ? new Set(keys) : new Set())}
                disabled={rows.length === 0}
              />
              <RefreshButton onClick={() => setReloadKey((k) => k + 1)} spinning={loading} />
            </>
          }
        >
          {PRIMARY.map((f) => (
            <FilterField key={f.value} label={f.label}>
              <MultiValueInput
                values={draft[f.value] ?? []}
                onChange={(v) => changePrimary(f.value, v)}
                max={MAX_VALUES}
                placeholder={`${f.label} — type and press Enter…`}
              />
            </FilterField>
          ))}
        </ListFilterPanel>
      </div>

      {/* Nothing here searches until Apply. */}
      <ExtraFiltersModal
        open={extraOpen}
        onClose={() => {
          setDraft((d) => ({ ...d, ...appliedExtras() }));
          setExtraOpen(false);
        }}
        onReset={() => setDraft((d) => ({ ...d, ...Object.fromEntries(EXTRA.map((f) => [f.value, []])) }))}
        onApply={() => {
          runSearch(draft);
          setExtraOpen(false);
        }}
      >
        {EXTRA.map((f) => (
          <FilterField key={f.value} label={f.label}>
            {f.value === 'doc_type' ? (
              <select
                className="input"
                value={draft.doc_type?.[0] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, doc_type: e.target.value ? [e.target.value] : [] }))}
              >
                <option value="">All</option>
                {DOC_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <MultiValueInput
                values={draft[f.value] ?? []}
                onChange={(v) => setDraft((d) => ({ ...d, [f.value]: v }))}
                max={MAX_VALUES}
                placeholder={`${f.label} — type and press Enter…`}
              />
            )}
          </FilterField>
        ))}
      </ExtraFiltersModal>

      {data && (
        <TotalCards
          items={
            isReserved
              ? [
                  ['Qty Picking', data.totals.qty_picking],
                  ['Qty Packing', data.totals.qty_packing],
                  ['Packing Difference', data.totals.packing_diff],
                  ['Reserved Quantity', data.totals.qty],
                ]
              : [
                  ['Qty Delivered (SD)', data.totals.qty_delivered],
                  ['Qty Received (TO In)', data.totals.qty_received],
                  ['In Transit Quantity', data.totals.qty],
                  ['Documents', data.totals.documents],
                ]
          }
        />
      )}
      {isReserved && (data?.cancelled_qty ?? 0) > 0 && (
        <p className="mx-5 mb-3 text-xs text-slate-500">
          {fmt(data?.cancelled_qty)} more is still held for cancelled SO / TO, which are not listed.
        </p>
      )}

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                <th className="w-10 !px-2" aria-label="Expand" />
                <th>No</th>
                <th>Doc Type</th>
                <th>Transaction ID</th>
                <th>ERP Doc ID</th>
                <th>Status</th>
                <th>{isReserved ? 'Warehouse' : 'Origin Warehouse'}</th>
                <th>{isReserved ? 'Customer / Destination' : 'Destination Warehouse'}</th>
                <th>{isReserved ? 'Picking ID' : 'SD ID'}</th>
                <th>Packing ID</th>
                <QtyHeads isReserved={isReserved} />
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
                rows.map((r, i) => {
                  const key = `${r.doc_type}-${r.doc_id}`;
                  const open = !collapsed.has(key);
                  const lines = r.lines ?? [];
                  return [
                    <tr key={key} className={expandableRowClass(open, loading)} onClick={() => toggleRow(key)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(key)} noun="materials" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {r.doc_type === 'SO' ? 'Sales Order' : 'Transfer Order'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Link to={docPath(r)} className="font-medium text-brand-700 hover:underline">
                          {r.doc_number ?? r.doc_id}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.erp_doc_id}</td>
                      <td className="px-4 py-3">
                        {r.status && (
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-medium ${soStatusBadgeClass(r.status)}`}
                          >
                            {r.status}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.warehouse_name}</td>
                      <td className="px-4 py-3 text-slate-700">{r.party}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700" onClick={(e) => e.stopPropagation()}>
                        <RefsCell r={r} isReserved={isReserved} kind="first" />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700" onClick={(e) => e.stopPropagation()}>
                        <RefsCell r={r} isReserved={isReserved} kind="packing" />
                      </td>
                      <QtyCells r={r} isReserved={isReserved} />
                    </tr>,
                    open && (
                      <AccordionPanelRow
                        key={`${key}-lines`}
                        colSpan={cols}
                        title="Materials"
                        noun="materials"
                        total={lines.length}
                        matching={lines.length}
                        filtered={false}
                        shown={lines.length}
                        detailPath={docPath(r)}
                      >
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-left text-slate-600">
                            <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                              <th>No</th>
                              <th>PN / Material Code</th>
                              <th>Material Name</th>
                              <th>{isReserved ? 'Picking ID' : 'SD ID'}</th>
                              <th>Packing ID</th>
                              <QtyHeads isReserved={isReserved} />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {lines.map((l, j) => (
                              <tr key={`${l.material_code}-${j}`} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 text-slate-500">{j + 1}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{l.material_code}</td>
                                <td className="px-4 py-2.5 text-slate-700">{l.material_name}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                                  <RefsCell r={l} isReserved={isReserved} kind="first" />
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                                  <RefsCell r={l} isReserved={isReserved} kind="packing" />
                                </td>
                                <QtyCells r={l} isReserved={isReserved} compact />
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={cols} className="px-6 py-10 text-center text-slate-400">
                    {applied.length ? 'No document matches the filters.' : 'No document holds this quantity.'}
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

/** The qty column headers, for the document row and its materials alike. */
function QtyHeads({ isReserved }: { isReserved: boolean }) {
  return isReserved ? (
    <>
      <th className="text-right">Qty Picking</th>
      <th className="text-right">Qty Packing</th>
      <th className="text-right">Packing Difference</th>
      <th className="text-right">Reserved Quantity</th>
    </>
  ) : (
    <>
      <th className="text-right">Qty Delivered (SD)</th>
      <th className="text-right">Qty Received (TO In)</th>
      <th className="text-right">In Transit Quantity</th>
    </>
  );
}

function QtyCells({ r, isReserved, compact }: { r: DocumentRow; isReserved: boolean; compact?: boolean }) {
  const pad = compact ? 'px-4 py-2.5' : 'px-4 py-3';
  return (
    <>
      {isReserved ? (
        <>
          <td className={`${pad} text-right text-slate-700`}>{fmt(r.qty_picking)}</td>
          <td className={`${pad} text-right text-slate-700`}>{r.qty_packing != null ? fmt(r.qty_packing) : ''}</td>
          <td className={`${pad} text-right ${r.packing_diff ? 'font-medium text-rose-600' : 'text-slate-700'}`}>
            {r.packing_diff ? `−${fmt(r.packing_diff)}` : fmt(0)}
          </td>
        </>
      ) : (
        <>
          <td className={`${pad} text-right text-slate-700`}>{fmt(r.qty_delivered)}</td>
          <td className={`${pad} text-right text-slate-700`}>{fmt(r.qty_received)}</td>
        </>
      )}
      <td className={`${pad} text-right font-semibold text-slate-800`}>{fmt(r.qty)}</td>
    </>
  );
}

/** Picking / SD ids (`first`) or Packing ids of a row, with the +N list. */
function RefsCell({ r, isReserved, kind }: { r: DocumentRow; isReserved: boolean; kind: 'first' | 'packing' }) {
  const base = OUTBOUND_BASE[r.doc_type];
  if (kind === 'packing') {
    return <DocRefsCell refs={r.packings} path={`${base}/packing`} label="Packing ID" context={r.doc_number} />;
  }
  return isReserved ? (
    <DocRefsCell refs={r.pickings} path={`${base}/picking`} label="Picking ID" context={r.doc_number} />
  ) : (
    <DocRefsCell refs={r.sds} path={`${base}/delivery`} label="SD ID" context={r.doc_number} />
  );
}
