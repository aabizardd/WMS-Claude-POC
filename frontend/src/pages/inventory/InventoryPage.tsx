import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../../lib/api";
import { downloadFile } from "../../lib/download";
import type {
  InventoryBinGroup,
  InventoryFilter,
  InventoryFilterField,
  InventoryRow,
  Paginated,
} from "../../types";
import { useSort } from "../../hooks/useSort";
import SortableTh from "../../components/SortableTh";
import MultiValueInput from "../../components/MultiValueInput";
import RowActionMenu from "../../components/RowActionMenu";
import TablePager from "../../components/TablePager";
import InventoryBinTable from "./InventoryBinTable";
import QtySourceLink from "./QtySourceLink";
import { useToast } from "../../context/ToastContext";
import { ExportIcon } from "../../components/ToolbarMenu";
import ExportConfirmModal, { type ExportScope, type ExportSummary } from "../../components/ExportConfirmModal";
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
} from "../../components/ListView";

/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/**
 * Without a Bin filter an open row shows at most this many bins and then
 * points at the detail page for the rest.
 */
const BIN_PREVIEW = 10;

const fmt = (n: number) => n.toLocaleString();

/** The list row, with its bin breakdown (asked for with include_bins). */
type Row = InventoryRow & { bins?: InventoryBinGroup[] };

/** Quantities summed over every row that matches, not just this page. */
interface Totals {
  on_hand: number;
  avail_qty: number;
  freeze_qty: number;
  qty_issue: number;
  quality_issue: number;
  reserved_qty: number;
  in_transit_qty: number;
}

/**
 * The filter habit shared by every tracking-style list: the three fields used
 * most sit above the table and search as they change; the rest live behind
 * "Additional filters" and count once applied.
 */
const PRIMARY_FIELDS: { value: InventoryFilterField; label: string }[] = [
  { value: "material_code", label: "Material Code" },
  { value: "warehouse_name", label: "Warehouse" },
  { value: "bin", label: "Bin" },
];

const EXTRA_FIELDS: { value: InventoryFilterField; label: string }[] = [
  { value: "material_name", label: "Material Name" },
  { value: "material_type", label: "Type" },
  { value: "material_category", label: "Category" },
  { value: "primary_uom", label: "UoM" },
];

const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];

type Draft = Record<InventoryFilterField, string[]>;

function emptyDraft(): Draft {
  return Object.fromEntries(FILTER_FIELDS.map((f) => [f.value, []])) as unknown as Draft;
}

/**
 * The documents page behind a Reserved / In Transit total, carrying over the
 * filters it shares with this list (Part Number, Material Name, Warehouse).
 */
function qtyDocumentsHref(type: "reserved" | "in-transit", applied: InventoryFilter[]) {
  const carry: Record<string, string> = {
    material_code: "material_code",
    material_name: "material_name",
    warehouse_name: "warehouse",
  };
  const filters = applied.flatMap((f) => (carry[f.field] ? [{ field: carry[f.field], values: f.values }] : []));
  const qs = filters.length ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : "";
  return `/admin/inventory/${type}${qs}`;
}

function draftFrom(filters: InventoryFilter[]): Draft {
  const d = emptyDraft();
  for (const f of filters) d[f.field] = f.values;
  return d;
}

function fieldLabel(f: InventoryFilterField) {
  return FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;
}

/** Filters live in the URL so a refresh or a shared link shows the same list. */
function readFilters(sp: URLSearchParams): InventoryFilter[] {
  const raw = sp.get("filters");
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(FILTER_FIELDS.map((f) => f.value));
    return parsed.flatMap((f): InventoryFilter[] => {
      const field = (f as InventoryFilter)?.field;
      const values = (f as InventoryFilter)?.values;
      if (!known.has(field) || !Array.isArray(values)) return [];
      const clean = values.filter((v): v is string => typeof v === "string" && !!v.trim());
      return clean.length ? [{ field, values: clean }] : [];
    });
  } catch {
    return [];
  }
}

/** Does this bin match the Bin filter? Mirrors the server (values OR-ed). */
function binMatches(b: InventoryBinGroup, f: InventoryFilter): boolean {
  return f.values.some((raw) => {
    const v = raw.trim().toLowerCase();
    return (
      !!v &&
      ((b.bin_location ?? "").toLowerCase().includes(v) ||
        (b.bin_code ?? "").toLowerCase().includes(v))
    );
  });
}

// Quantity columns are aggregates the server cannot sort by.
const qtyTh = (label: string) => (
  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">{label}</th>
);

/** Columns before the first quantity: expand, No, and seven descriptive ones (WH Name included). */
const LEAD_COLS = 9;
/** Every column: lead + 7 quantities + Actions. */
const COLS = LEAD_COLS + 7 + 1;

export default function InventoryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => ({
    filters: readFilters(searchParams),
  }));

  const [data, setData] = useState<(Paginated<Row> & { totals?: Totals }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<InventoryFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);

  // Every row's bins are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  const appliedKey = JSON.stringify(applied);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<Paginated<Row> & { totals?: Totals }>("/inventory", {
        params: {
          page,
          limit: pageSize,
          filters: applied.length ? JSON.stringify(applied) : undefined,
          include_bins: "true",
          ...params(),
        },
      })
      .then((r) => active && setData(r.data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, appliedKey, sort.sortBy, sort.order, reloadKey]);

  // Keep the filters in the URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (applied.length) next.set("filters", JSON.stringify(applied));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const binFilters = applied.filter((f) => f.field === "bin");

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
  function changePrimary(field: InventoryFilterField, values: string[]) {
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

  function valueLabel(_field: InventoryFilterField, value: string) {
    return value;
  }

  const extraCount = applied.filter((f) => EXTRA_FIELDS.some((x) => x.value === f.field)).length;

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
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (anyOpen) rows.forEach((r) => next.add(r.id));
      else rows.forEach((r) => next.delete(r.id));
      return next;
    });
  }

  const filterParam = applied.length ? JSON.stringify(applied) : undefined;

  /** The confirmation's numbers, counted by the backend for both options. */
  function loadExportSummary() {
    return api
      .get<ExportSummary>("/inventory/export/summary", { params: { filters: filterParam } })
      .then((r) => r.data);
  }

  /**
   * Filtered: every row the filters match (not only this page); all: every
   * row, whatever the filters. Both in the list's order; the list itself
   * (filters, page) is left as it is.
   */
  async function exportExcel(scope: ExportScope) {
    if (exporting) return;
    setExportOpen(false);
    setExporting(true);
    toast.info("Preparing the export…");
    try {
      await downloadFile(
        "/inventory/export",
        { filters: scope === "filtered" ? filterParam : undefined, ...params() },
        "inventory_details.xlsx",
      );
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const rowNo = (i: number) => (page - 1) * pageSize + i + 1;
  const totals = data?.totals;

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Inventory List"
          subtitle="View stock information across locations"
          menu={[
            {
              label: exporting ? "Exporting…" : "Export",
              icon: <ExportIcon />,
              onClick: () => !exporting && setExportOpen(true),
            },
          ]}
        />

        {/* The same totals as the table's first row, readable without scrolling sideways. */}
        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            <StatCard label="Total Stock On Hand" value={totals.on_hand} color="#5166AE" icon={ICONS.boxes} />
            <StatCard label="Total Available Quantity" value={totals.avail_qty} color="#2E8F5C" icon={ICONS.packageCheck} />
            <StatCard label="Total Freeze Quantity" value={totals.freeze_qty} color="#5A7ACD" icon={ICONS.packageX} />
            <StatCard label="Total Quantity Issue" value={totals.qty_issue} color="#FF7F11" icon={ICONS.packageMinus} />
            <StatCard label="Total Quality Issue" value={totals.quality_issue} color="#CE2626" icon={ICONS.starX} />
            <StatCard
              label="Total Reserved Quantity"
              value={totals.reserved_qty}
              color="#6E5034"
              icon={ICONS.bookmarkCheck}
              href={qtyDocumentsHref("reserved", applied)}
            />
            <StatCard
              label="Total In Transit Quantity"
              value={totals.in_transit_qty}
              color="#547792"
              icon={ICONS.truck}
              href={qtyDocumentsHref("in-transit", applied)}
            />
          </div>
        )}

        {/* Filters: three that search as they change, the rest behind the modal. */}
        <ListFilterPanel
          extraCount={extraCount}
          onOpenExtras={() => {
            setDraft((d) => ({ ...d, ...appliedExtras() }));
            setExtraOpen(true);
          }}
          onClear={applied.length > 0 ? clearAll : undefined}
          chips={applied.map((f) => ({
            label: fieldLabel(f.field),
            value: f.values.map((v) => valueLabel(f.field, v)).join(" or "),
          }))}
          chipsNote={binFilters.length > 0 ? "bin lists show only the matching bins" : undefined}
          toolbar={
            <>
              <ExpandAllButton anyOpen={anyOpen} onClick={toggleAll} disabled={rows.length === 0} />
              <RefreshButton onClick={() => setReloadKey((k) => k + 1)} spinning={loading} />
            </>
          }
        >
            {PRIMARY_FIELDS.map((f) => (
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

      {/* The remaining columns, one field each. Nothing here searches until Apply. */}
      <ExportConfirmModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filters={applied.map((f) => ({
          label: fieldLabel(f.field),
          value: f.values.map((v) => valueLabel(f.field, v)).join(" or "),
        }))}
        loadSummary={loadExportSummary}
        onConfirm={exportExcel}
      />

      <ExtraFiltersModal open={extraOpen} onClose={closeExtras} onReset={resetExtras} onApply={applyExtras}>
        {EXTRA_FIELDS.map((f) => (
          <FilterField key={f.value} label={f.label}>
            <MultiValueInput
              values={draft[f.value] ?? []}
              onChange={(v) => setDraft((d) => ({ ...d, [f.value]: v }))}
              max={MAX_VALUES}
              placeholder={`${f.label} — type and press Enter…`}
            />
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
                <SortableTh label="Material Name" col="material_name" sort={sort} onSort={onSort} pad="px-4" className="whitespace-nowrap" />
                <SortableTh label="Material Code" col="material_code" sort={sort} onSort={onSort} pad="px-4" className="whitespace-nowrap" />
                <SortableTh label="WH Name" col="warehouse_name" sort={sort} onSort={onSort} pad="px-4" className="whitespace-nowrap" />
                <SortableTh label="Material Type" col="material_type" sort={sort} onSort={onSort} pad="px-4" className="whitespace-nowrap" />
                <SortableTh label="Material Category" col="material_category" sort={sort} onSort={onSort} pad="px-4" className="whitespace-nowrap" />
                <SortableTh label="Primary UoM" col="primary_uom" sort={sort} onSort={onSort} pad="px-4" className="whitespace-nowrap" />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Secondary UoM</th>
                {qtyTh("Stock On Hand")}
                {qtyTh("Available Quantity")}
                {qtyTh("Freeze Quantity")}
                {qtyTh("Quantity Issue")}
                {qtyTh("Quality Issue")}
                {qtyTh("Reserved Quantity")}
                {qtyTh("In Transit Quantity")}
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {/* Totals over every matching row, not only this page. */}
              {totals && (data?.total_data ?? 0) > 0 && (
                <tr className="bg-brand-50 font-semibold text-brand-800">
                  <td colSpan={LEAD_COLS} className="px-4 py-3">
                    Total · {fmt(data?.total_data ?? 0)} material(s)
                    {applied.length > 0 && (
                      <span className="ml-1 font-normal text-brand-700/80">matching the filters</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{fmt(totals.on_hand)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.avail_qty)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.freeze_qty)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.qty_issue)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.quality_issue)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.reserved_qty)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.in_transit_qty)}</td>
                  <td className="sticky right-0 bg-brand-50 px-4 py-3 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]" />
                </tr>
              )}

              {loading && !data ? (
                <tr>
                  <td colSpan={COLS} className="px-5 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((r, i) => {
                  const open = !collapsed.has(r.id);
                  const all = r.bins ?? [];
                  const matching = binFilters.length
                    ? all.filter((b) => binFilters.every((f) => binMatches(b, f)))
                    : all;
                  // A Bin filter shows every match; otherwise only the first few.
                  const bins = binFilters.length ? matching : matching.slice(0, BIN_PREVIEW);
                  return [
                    <tr key={r.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(r.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(r.id)} noun="bins" />
                      <td className="px-4 py-3 text-slate-500">{rowNo(i)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-800">{r.material_name ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.material_code}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.warehouse_name ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.material_type ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.material_category ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.primary_uom ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.secondary_uom ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{fmt(r.on_hand)}</td>
                      <td
                        className="px-4 py-3 text-right text-slate-800"
                        title={
                          r.freeze_qty
                            ? `${r.avail_in_bins} in bins − ${r.freeze_qty} frozen = ${r.avail_qty} usable`
                            : undefined
                        }
                      >
                        {fmt(r.avail_qty)}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-slate-800"
                        title="Available stock parked in a KIT bin — frozen, so it is already taken out of Available"
                      >
                        {fmt(r.freeze_qty)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">{fmt(r.qty_issue)}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{fmt(r.quality_issue)}</td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        <QtySourceLink inventoryId={r.id} type="reserved" qty={r.reserved_qty} />
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        <QtySourceLink inventoryId={r.id} type="in-transit" qty={r.in_transit_qty} />
                      </td>
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          actions={[
                            {
                              label: "Detail",
                              icon: <DetailIcon />,
                              onClick: () => navigate(`/admin/inventory/list/${r.id}`),
                            },
                          ]}
                        />
                      </td>
                    </tr>,

                    open && (
                      <AccordionPanelRow
                        key={`${r.id}-bins`}
                        colSpan={COLS}
                        title="Bin List"
                        noun="bins"
                        total={all.length}
                        matching={matching.length}
                        filtered={binFilters.length > 0}
                        shown={bins.length}
                        detailPath={`/admin/inventory/list/${r.id}`}
                      >
                        <InventoryBinTable
                          bins={bins}
                          emptyText={
                            binFilters.length
                              ? "No bin on this material matches the Bin filter."
                              : "No stock in any bin."
                          }
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={COLS} className="px-5 py-10 text-center text-slate-400">
                    {applied.length > 0
                      ? "No inventory matches the filters."
                      : "No inventory yet. It is generated when a Goods Receive is received."}
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

/** WMS dev's inventory card icons (Lucide). */
const ICONS = {
  boxes: (
    <>
      <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
      <path d="m7 16.5-4.74-2.85" />
      <path d="m7 16.5 5-3" />
      <path d="M7 16.5v5.17" />
      <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
      <path d="m17 16.5-5-3" />
      <path d="m17 16.5 4.74-2.85" />
      <path d="M17 16.5v5.17" />
      <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
      <path d="M12 8 7.26 5.15" />
      <path d="m12 8 4.74-2.85" />
      <path d="M12 13.5V8" />
    </>
  ),
  packageCheck: (
    <>
      <path d="m16 16 2 2 4-4" />
      <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
      <path d="m7.5 4.27 9 5.15" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" x2="12" y1="22" y2="12" />
    </>
  ),
  packageX: (
    <>
      <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
      <path d="m7.5 4.27 9 5.15" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" x2="12" y1="22" y2="12" />
      <path d="m17 13 5 5m-5 0 5-5" />
    </>
  ),
  packageMinus: (
    <>
      <path d="M16 16h6" />
      <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
      <path d="m7.5 4.27 9 5.15" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" x2="12" y1="22" y2="12" />
    </>
  ),
  starX: (
    <>
      <path d="m15.5 15.5 5 5" />
      <path d="m20.063 11.525 1.777-1.731a.53.53 0 00-.294-.905l-5.166-.755a2.1 2.1 0 01-1.595-1.16l-2.31-4.68a.53.53 0 00-.95.001L9.216 6.974a2.1 2.1 0 01-1.597 1.16l-5.165.755a.53.53 0 00-.294.906l3.736 3.637a2.1 2.1 0 01.611 1.879l-.88 5.139a.53.53 0 00.769.56l4.617-2.428a2.1 2.1 0 01.987-.243 2 2 0 01.132.004" />
      <path d="m20.5 15.5-5 5" />
    </>
  ),
  bookmarkCheck: (
    <>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
      <path d="m9 10 2 2 4-4" />
    </>
  ),
  truck: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
};

/**
 * One inventory total, as WMS dev draws it: a coloured left rule, the label
 * with a tinted icon, the value in the same colour. A card with a link opens
 * the documents behind its total in a new tab ("See detail").
 */
function StatCard({
  label,
  value,
  color,
  icon,
  href,
}: {
  label: string;
  value: number;
  color: string;
  icon: ReactNode;
  href?: string;
}) {
  const body = (
    <div className="flex h-full flex-col justify-between gap-1 border-l-2 pl-2.5" style={{ borderColor: color }}>
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-xs font-normal leading-4 text-[#4A5565] opacity-80 dark:text-slate-300">{label}</span>
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{ color, backgroundColor: `${color}33` }}
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {icon}
          </svg>
        </span>
      </div>
      <div className="mt-auto flex w-full items-baseline justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums tracking-tight" style={{ color }}>
          {value.toLocaleString()}
        </span>
        {href && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium group-hover:underline" style={{ color }}>
            See detail
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
  const card =
    "group flex flex-col justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3.5 dark:border-slate-700 dark:bg-slate-800/60";
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`See the documents behind the ${label.toLowerCase()}`}
      className={`${card} cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`}
    >
      {body}
    </a>
  ) : (
    <div className={card}>{body}</div>
  );
}
