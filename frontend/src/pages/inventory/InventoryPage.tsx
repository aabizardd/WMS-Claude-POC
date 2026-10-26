import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../../lib/api";
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
              label: "Export",
              icon: <ExportIcon />,
              onClick: () => toast.info("Export is not available yet."),
            },
          ]}
        />

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

      {/* The same totals as the table's first row, readable without scrolling sideways. */}
      {totals && (
        <TotalCards
          gridClass="grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"
          items={[
            ["Stock On Hand", totals.on_hand],
            ["Available Quantity", totals.avail_qty],
            ["Freeze Quantity", totals.freeze_qty],
            ["Quantity Issue", totals.qty_issue],
            ["Quality Issue", totals.quality_issue],
            ["Reserved Quantity", totals.reserved_qty],
            ["In Transit Quantity", totals.in_transit_qty],
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
