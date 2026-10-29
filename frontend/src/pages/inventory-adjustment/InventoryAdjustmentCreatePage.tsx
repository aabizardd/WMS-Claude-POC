import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import api from "../../lib/api";
import type {
  AdjBinOption,
  AdjDiscrepancyOption,
  AdjMaterialOption,
  AdjPendingDoc,
  IaType,
  IaTypeInfo,
} from "../../types";
import { useToast } from "../../context/ToastContext";
import { useConfirm } from "../../context/ConfirmContext";
import { useWarehouse } from "../../context/WarehouseContext";
import SearchableSelect from "../../components/SearchableSelect";
import { Lucide, MasterPager, icons } from "../../components/master/MasterKit";
import { adjStatusLabel } from "./iaShared";

const BASE = "/admin/inventory-adjustments";
const EPS = 1e-9;
const MEMO_MAX = 300;
const CARD = "rounded-xl bg-white shadow-md dark:bg-slate-800";

interface Line {
  qty_adjustment: number;
  qty_passed: number;
  qty_non_passed: number;
}

/** One picked material: its candidate bins and the bins ticked so far. */
interface Group {
  material: AdjMaterialOption & { material_id: string };
  bins: AdjBinOption[];
  loaded: boolean;
  open: boolean;
  lines: Record<string, Line>;
}

const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 4 });

function errMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const m = err.response?.data?.message;
    if (Array.isArray(m)) return m.join(", ");
    if (typeof m === "string") return m;
  }
  return fallback;
}

/** What the type lets the user do, shown above the header fields (WMS dev's blue note). */
function ruleNote(rule: IaTypeInfo): ReactNode {
  if (rule.qty_mode === "auto_negative")
    return `Only bins with ${rule.filter_bucket === "qty_issue" ? "Quantity Issue" : "Quality Issue"} are available. The adjustment takes the whole issue qty and cannot be edited.`;
  if (rule.qty_mode === "passed_non_passed")
    return "Only bins with Quality Issue are available. Enter Qty Passed (back to available, sent to Oracle) and/or Qty Non-Passed.";
  return "All bins are available. Enter a positive qty to add stock or a negative qty to reduce it.";
}

export default function InventoryAdjustmentCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { activeWarehouseId } = useWarehouse();

  const [types, setTypes] = useState<IaTypeInfo[]>([]);
  const [type, setType] = useState<IaType | "">("");
  const [classes, setClasses] = useState<
    { id: string; name: string | null; oracleId: string }[]
  >([]);
  const [classId, setClassId] = useState("");
  const [departments, setDepartments] = useState<
    { id: string; name: string | null; oracleId: string }[]
  >([]);
  const [departmentId, setDepartmentId] = useState("");
  const [memo, setMemo] = useState("");

  // Material card grid
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [mPage, setMPage] = useState(1);
  const [mSize, setMSize] = useState(9);
  const [materials, setMaterials] = useState<{
    rows: AdjMaterialOption[];
    total: number;
  }>({ rows: [], total: 0 });
  const [mLoading, setMLoading] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AdjDiscrepancyOption[]>(
    [],
  );
  const [selectedDiscs, setSelectedDiscs] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const rule = useMemo(
    () => types.find((t) => t.value === type) ?? null,
    [types, type],
  );
  const qtyMode = rule?.qty_mode;

  // Lookups and the user's own department as the default.
  useEffect(() => {
    api
      .get<IaTypeInfo[]>("/inventory-adjustments/types")
      .then((r) => setTypes(r.data))
      .catch(() => setTypes([]));
    api
      .get<{ id: string; name: string | null; oracleId: string }[]>(
        "/classes/options",
      )
      .then((r) => {
        setClasses(r.data);
        const preferred = r.data.find((c) =>
          /inventory international/i.test(c.name ?? ""),
        );
        if (preferred) setClassId((cur) => cur || preferred.id);
      })
      .catch(() => setClasses([]));
    api
      .get<{ id: string; name: string | null; oracleId: string }[]>(
        "/departments/options",
      )
      .then((r) => setDepartments(r.data))
      .catch(() => setDepartments([]));
    api
      .get<{ department_id: string | null }>("/inventory-adjustments/defaults")
      .then(
        (r) =>
          r.data.department_id &&
          setDepartmentId((cur) => cur || r.data.department_id!),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setMPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // FR-IA-05: the material list depends on the chosen type's stock bucket.
  useEffect(() => {
    if (!type) {
      setMaterials({ rows: [], total: 0 });
      return;
    }
    let cancelled = false;
    setMLoading(true);
    api
      .get<{ rows: AdjMaterialOption[]; total_data: number }>(
        "/inventory-adjustments/materials",
        {
          params: {
            adjustment_type: type,
            search: debounced || undefined,
            page: mPage,
            limit: mSize,
          },
        },
      )
      .then(
        (r) =>
          !cancelled &&
          setMaterials({ rows: r.data.rows, total: r.data.total_data }),
      )
      .catch(() => !cancelled && setMaterials({ rows: [], total: 0 }))
      .finally(() => !cancelled && setMLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, debounced, mPage, mSize, activeWarehouseId]);

  // Another warehouse scope means other bins: start over.
  useEffect(() => {
    setGroups([]);
    setSelectedDiscs(new Set());
  }, [activeWarehouseId]);

  // ----- selection -----
  const selectedIds = new Set(groups.map((g) => g.material.material_id));

  async function toggleMaterial(m: AdjMaterialOption) {
    if (!m.material_id || !type) return;
    const id = m.material_id;
    if (selectedIds.has(id)) {
      removeMaterial(id);
      return;
    }
    setGroups((gs) => [
      ...gs,
      {
        material: { ...m, material_id: id },
        bins: [],
        loaded: false,
        open: true,
        lines: {},
      },
    ]);
    try {
      const r = await api.get<AdjBinOption[]>("/inventory-adjustments/bins", {
        params: { material_id: id, adjustment_type: type },
      });
      setGroups((gs) =>
        gs.map((g) =>
          g.material.material_id === id
            ? { ...g, bins: r.data, loaded: true }
            : g,
        ),
      );
    } catch {
      setGroups((gs) =>
        gs.map((g) =>
          g.material.material_id === id ? { ...g, loaded: true } : g,
        ),
      );
    }
  }

  function removeMaterial(id: string) {
    setGroups((gs) => gs.filter((g) => g.material.material_id !== id));
  }

  function patchGroup(id: string, fn: (g: Group) => Group) {
    setGroups((gs) =>
      gs.map((g) => (g.material.material_id === id ? fn(g) : g)),
    );
  }

  /** A newly ticked bin: Discrepancy types take the whole bucket, the rest start at 0. */
  function freshLine(b: AdjBinOption): Line {
    return {
      qty_adjustment: b.suggested_qty_adjustment ?? 0,
      qty_passed: 0,
      qty_non_passed: 0,
    };
  }

  function toggleBin(id: string, b: AdjBinOption) {
    if (!b.bin_id) return;
    const binId = b.bin_id;
    patchGroup(id, (g) => {
      const lines = { ...g.lines };
      if (lines[binId]) delete lines[binId];
      else lines[binId] = freshLine(b);
      return { ...g, lines };
    });
  }

  function toggleAllBins(id: string) {
    patchGroup(id, (g) => {
      const all = g.bins.filter((b) => b.bin_id);
      const everyOn = all.length > 0 && all.every((b) => g.lines[b.bin_id!]);
      if (everyOn) return { ...g, lines: {} };
      const lines = { ...g.lines };
      for (const b of all)
        if (!lines[b.bin_id!]) lines[b.bin_id!] = freshLine(b);
      return { ...g, lines };
    });
  }

  function patchLine(id: string, binId: string, patch: Partial<Line>) {
    patchGroup(id, (g) => ({
      ...g,
      lines: { ...g.lines, [binId]: { ...g.lines[binId], ...patch } },
    }));
  }

  /** FR-IA-01 rule 4: changing the type clears every selection, after a confirmation. */
  async function changeType(t: string) {
    const next = t as IaType;
    if (next === type) return;
    if (groups.length > 0) {
      const ok = await confirm({
        title: "Change the type?",
        description:
          "Changing the Type clears every material, bin, qty and discrepancy already selected.",
        confirmText: "Change type",
        type: "warning",
      });
      if (!ok) return;
    }
    setType(next);
    setGroups([]);
    setSelectedDiscs(new Set());
    setDiscrepancies([]);
    setMPage(1);
  }

  // ----- validation & totals -----
  const usable = (b: AdjBinOption) =>
    Math.max(0, b.qty_available - (b.pending_qty ?? 0));

  function lineError(g: Group, b: AdjBinOption, l: Line): string | null {
    const decimals = (...vals: number[]) =>
      g.material.allows_decimal === false &&
      vals.some((v) => Math.abs(v - Math.round(v)) > EPS);
    if (qtyMode === "passed_non_passed") {
      const total = l.qty_passed + l.qty_non_passed;
      if (l.qty_passed < 0 || l.qty_non_passed < 0)
        return "Qty Passed and Non-Passed must be positive";
      if (!(total > 0)) return "Enter Qty Passed and/or Qty Non-Passed";
      if (total > b.quality_issue + EPS)
        return `Exceeds Quality Issue (${fmt(b.quality_issue)})`;
      if (decimals(l.qty_passed, l.qty_non_passed))
        return "This unit of measure does not allow decimals";
      return null;
    }
    if (qtyMode === "free_signed") {
      if (Math.abs(l.qty_adjustment) < EPS) return "Enter a non-zero quantity";
      if (l.qty_adjustment < 0 && usable(b) + l.qty_adjustment < -EPS)
        return `Exceeds available qty (${fmt(usable(b))})`;
      if (decimals(l.qty_adjustment))
        return "This unit of measure does not allow decimals";
    }
    return null;
  }

  const picked = groups.flatMap((g) =>
    g.bins
      .filter((b) => b.bin_id && g.lines[b.bin_id])
      .map((b) => ({ g, b, l: g.lines[b.bin_id!] })),
  );
  const errors = picked.map((p) => lineError(p.g, p.b, p.l)).filter(Boolean);
  const lineQty = (l: Line) =>
    qtyMode === "passed_non_passed"
      ? l.qty_passed + l.qty_non_passed
      : l.qty_adjustment;
  const filledBins = picked.filter((p) => Math.abs(lineQty(p.l)) > EPS).length;
  const totalAdjustment = picked.reduce((s, p) => s + lineQty(p.l), 0);
  const warehouses = [
    ...new Set(picked.map((p) => p.b.warehouse_name).filter(Boolean)),
  ];
  const warehouseSummary =
    warehouses.length === 0
      ? "-"
      : warehouses.length === 1
        ? warehouses[0]
        : "Multiple warehouses";
  const emptyMaterials = groups.filter((g) => !Object.keys(g.lines).length);

  // FR-IA-10: discrepancy references follow the picked materials and bins.
  const discKey = `${type}|${groups.map((g) => g.material.material_id).join(",")}|${picked.map((p) => p.b.bin_id).join(",")}`;
  useEffect(() => {
    if (!type || !rule?.discrepancy_list || groups.length === 0) {
      setDiscrepancies([]);
      return;
    }
    api
      .get<AdjDiscrepancyOption[]>("/inventory-adjustments/discrepancies", {
        params: {
          adjustment_type: type,
          material_ids: groups.map((g) => g.material.material_id).join(","),
          bin_ids: picked.map((p) => p.b.bin_id).join(","),
        },
      })
      .then((r) => setDiscrepancies(r.data))
      .catch(() => setDiscrepancies([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discKey, rule?.discrepancy_list]);

  const blocking = !type
    ? "Select a Type."
    : !classId
      ? "Select a Class."
      : !departmentId
        ? "Select a Department."
        : picked.length === 0
          ? "Select at least one bin."
          : emptyMaterials.length > 0
            ? `Select a bin for ${emptyMaterials[0].material.material_code}, or remove it.`
            : errors.length > 0
              ? "Fix the highlighted bins."
              : "";

  async function submit() {
    if (blocking || saving) return;
    setSaving(true);
    try {
      const r = await api.post<{ id: string; adjustment_number: string }>(
        "/inventory-adjustments",
        {
          adjustment_type: type,
          class_id: classId,
          department_id: departmentId,
          memo: memo.trim() || undefined,
          items: picked.map(({ g, b, l }) => ({
            material_id: g.material.material_id,
            bin_id: b.bin_id,
            ...(qtyMode === "passed_non_passed"
              ? { qty_passed: l.qty_passed, qty_non_passed: l.qty_non_passed }
              : { qty_adjustment: l.qty_adjustment }),
          })),
          discrepancy_ids: [...selectedDiscs],
        },
      );
      toast.success(`${r.data.adjustment_number} submitted for approval`);
      navigate(`${BASE}/${r.data.id}`);
    } catch (err) {
      // Keep the review open so the user can read the error and retry.
      toast.error(errMessage(err, "Submit failed"));
    } finally {
      setSaving(false);
    }
  }

  const binColumns = qtyMode === "passed_non_passed" ? 6 : 5;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`${CARD} space-y-5 p-5`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(BASE)}
            aria-label="Back"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Lucide>{icons.chevronLeft}</Lucide>
          </button>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">
            Create Adjustment
          </h1>
        </div>

        {rule && (
          <div className="rounded-r-lg border-l-4 border-[#5166AE] bg-[#F2F4FD] px-4 py-3 text-sm text-[#41528c]">
            {ruleNote(rule)}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Type" required>
            <SearchableSelect
              value={type}
              onChange={changeType}
              placeholder="Select Type..."
              searchPlaceholder="Search type…"
              options={types.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
          <Field label="Class" required>
            <SearchableSelect
              value={classId}
              onChange={setClassId}
              placeholder="Select Class..."
              searchPlaceholder="Search class…"
              options={classes.map((c) => ({
                value: c.id,
                label: c.name ?? c.oracleId,
              }))}
            />
          </Field>
          <Field label="Department" required>
            <SearchableSelect
              value={departmentId}
              onChange={setDepartmentId}
              placeholder="Select Department..."
              searchPlaceholder="Search department…"
              options={departments.map((d) => ({
                value: d.id,
                label: d.name ?? d.oracleId,
              }))}
            />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-neutral-800 dark:text-slate-200">
              Memo
            </span>
            <span className="text-xs text-neutral-500">
              {memo.length}/{MEMO_MAX}
            </span>
          </div>
          <textarea
            className="min-h-[72px] w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-[#5166AE] focus:ring-2 focus:ring-[#5166AE]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={memo}
            maxLength={MEMO_MAX}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Reason or context for this adjustment..."
          />
        </div>
      </div>

      {/* Select Materials */}
      <div className={CARD}>
        <SectionHead
          title="Select Materials"
          subtitle="Select materials from your warehouse to include in this adjustment."
        />
        <div className="space-y-4 p-5">
          {!type ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Select a Type first to choose materials.
            </p>
          ) : (
            <>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400">
                  <Lucide>{icons.search}</Lucide>
                </span>
                <input
                  className="h-10 w-full rounded-lg border border-neutral-200 pl-10 pr-3 text-sm outline-none placeholder:text-neutral-400 focus:border-[#5166AE] focus:ring-2 focus:ring-[#5166AE]/20 dark:border-slate-600 dark:bg-slate-900"
                  placeholder="Search material by code or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {groups.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <span
                      key={g.material.material_id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#5166AE]/20 bg-[#5166AE]/10 px-3 py-0.5 text-xs font-semibold text-[#5166AE]"
                    >
                      {g.material.material_code}
                      {g.material.material_name && (
                        <span className="font-normal">
                          ({g.material.material_name})
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${g.material.material_code}`}
                        onClick={() => removeMaterial(g.material.material_id)}
                        className="ml-0.5 hover:text-[#2f3d73]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="grid max-h-72 grid-cols-1 gap-3 overflow-y-auto p-0.5 sm:grid-cols-2 lg:grid-cols-3">
                {materials.rows.map((m) => {
                  const on = !!m.material_id && selectedIds.has(m.material_id);
                  return (
                    <button
                      type="button"
                      key={m.material_id}
                      onClick={() => toggleMaterial(m)}
                      className={`relative flex items-center justify-between rounded-lg border p-3.5 text-left text-sm transition-all duration-200 ${
                        on
                          ? "border-[#5166AE] bg-[#F2F4FD] ring-1 ring-[#5166AE]"
                          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-3 pr-2">
                        <input
                          type="checkbox"
                          readOnly
                          checked={on}
                          tabIndex={-1}
                          className="pointer-events-none h-4 w-4 shrink-0 rounded border-neutral-300 accent-[#5166AE]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-neutral-900">
                            {m.material_code}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            {m.material_name ?? "-"}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        {fmt(m.in_stock ?? 0)} in stock
                      </span>
                    </button>
                  );
                })}
                {!mLoading && materials.rows.length === 0 && (
                  <p className="col-span-full py-6 text-center text-sm text-neutral-500">
                    {debounced
                      ? "No material matches the search."
                      : "No material has stock for this Type."}
                  </p>
                )}
              </div>

              <MasterPager
                className="mt-2"
                page={mPage}
                pageSize={mSize}
                total={materials.total}
                sizes={[9, 18, 27, 45]}
                onPage={setMPage}
                onPageSize={(n) => {
                  setMSize(n);
                  setMPage(1);
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Select Bins */}
      {groups.length > 0 && (
        <div className={CARD}>
          <SectionHead
            title="Select Bins"
            subtitle="Review candidate bins and specify the adjustment quantity for each bin."
            right={
              <span className="inline-flex items-center rounded-full border border-[#5166AE]/20 bg-[#5166AE]/10 px-3 py-0.5 text-[13px] font-semibold text-[#5166AE]">
                {picked.length} Bins Selected
              </span>
            }
          />
          <div className="space-y-4 p-5">
            {errors.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
                </svg>
                Enter a non-zero quantity on every selected bin, and keep a
                reduction within the available stock.
              </div>
            )}

            {groups.map((g) => {
              const id = g.material.material_id;
              const binList = g.bins.filter((b) => b.bin_id);
              const count = binList.filter((b) => g.lines[b.bin_id!]).length;
              const allOn = binList.length > 0 && count === binList.length;
              return (
                <div
                  key={id}
                  className="overflow-hidden rounded-xl border border-neutral-200 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-3 bg-neutral-50 px-4 py-3 dark:bg-slate-900/40">
                    <label className="flex min-w-0 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={(el) => {
                          if (el) el.indeterminate = count > 0 && !allOn;
                        }}
                        onChange={() => toggleAllBins(id)}
                        className="h-4 w-4 shrink-0 rounded border-neutral-300 accent-[#5166AE]"
                        aria-label={`Select every bin of ${g.material.material_code}`}
                      />
                      <span className="truncate">
                        <span className="font-semibold text-neutral-900 dark:text-white">
                          {g.material.material_code}
                        </span>{" "}
                        <span className="text-xs text-neutral-500">
                          ({g.material.material_name ?? "-"})
                        </span>
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-neutral-200/70 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                        {count}/{binList.length} bin(s)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchGroup(id, (x) => ({ ...x, open: !x.open }))
                        }
                        aria-label={g.open ? "Collapse bins" : "Expand bins"}
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-200"
                      >
                        <svg
                          className={`h-4 w-4 transition-transform ${g.open ? "" : "-rotate-90"}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {g.open && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="text-neutral-600">
                          <tr className="[&>th]:border-y [&>th]:border-neutral-100 [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                            <th className="w-10" />
                            <th>Warehouse</th>
                            <th>Bin</th>
                            <th>
                              {qtyMode === "free_signed"
                                ? "Available Qty"
                                : rule?.filter_bucket === "qty_issue"
                                  ? "Quantity Issue"
                                  : "Quality Issue"}
                            </th>
                            {qtyMode === "passed_non_passed" ? (
                              <>
                                <th>Qty Passed</th>
                                <th>Qty Non-Passed</th>
                              </>
                            ) : (
                              <th>Adjustment Qty</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {!g.loaded && (
                            <tr>
                              <td
                                colSpan={binColumns}
                                className="px-4 py-6 text-center text-neutral-400"
                              >
                                Loading bins…
                              </td>
                            </tr>
                          )}
                          {g.loaded && binList.length === 0 && (
                            <tr>
                              <td
                                colSpan={binColumns}
                                className="px-4 py-6 text-center text-neutral-400"
                              >
                                No bin holds this material for this Type.
                              </td>
                            </tr>
                          )}
                          {binList.map((b) => {
                            const l = g.lines[b.bin_id!];
                            const on = !!l;
                            const err = on ? lineError(g, b, l) : null;
                            return (
                              <tr
                                key={b.bin_id}
                                className={`[&>td]:border-b [&>td]:border-neutral-100 [&>td]:px-4 [&>td]:py-3 ${on ? "bg-[#F7F8FE]" : "bg-white"}`}
                              >
                                <td className="text-center">
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggleBin(id, b)}
                                    className="h-4 w-4 rounded border-neutral-300 accent-[#5166AE]"
                                    aria-label={`Select bin ${b.bin_code ?? b.bin_label}`}
                                  />
                                </td>
                                <td>
                                  <div className="text-neutral-900">
                                    {b.warehouse_name ?? "-"}
                                  </div>
                                  {b.warehouse_parent && (
                                    <div className="text-xs text-neutral-500">
                                      {b.warehouse_parent}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <div className="text-neutral-900">
                                    {b.bin_code ?? b.bin_label ?? "-"}
                                  </div>
                                  {b.bin_code && b.bin_label && (
                                    <div className="text-xs text-neutral-500">
                                      {b.bin_label}
                                    </div>
                                  )}
                                  {b.pending_docs.length > 0 && (
                                    <PendingDocs
                                      docs={b.pending_docs}
                                      total={b.pending_qty}
                                    />
                                  )}
                                </td>
                                <td className="text-neutral-700">
                                  {qtyMode === "free_signed" ? (
                                    b.pending_qty > 0 ? (
                                      <span
                                        title={`${fmt(b.qty_available)} recorded, ${fmt(b.pending_qty)} held by other documents`}
                                      >
                                        <span className="font-semibold text-neutral-900">
                                          {fmt(usable(b))}
                                        </span>
                                        <span className="text-xs text-neutral-500">
                                          {" "}
                                          of {fmt(b.qty_available)}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="font-semibold text-neutral-900">
                                        {fmt(b.qty_available)}
                                      </span>
                                    )
                                  ) : (
                                    <span className="font-semibold text-neutral-900">
                                      {fmt(
                                        rule?.filter_bucket === "qty_issue"
                                          ? b.qty_issue
                                          : b.quality_issue,
                                      )}
                                    </span>
                                  )}
                                </td>
                                {qtyMode === "passed_non_passed" ? (
                                  <>
                                    <td>
                                      <QtyPill
                                        value={on ? l.qty_passed : 0}
                                        disabled={!on}
                                        invalid={!!err}
                                        min={0}
                                        onChange={(v) =>
                                          patchLine(id, b.bin_id!, {
                                            qty_passed: v,
                                          })
                                        }
                                      />
                                    </td>
                                    <td>
                                      <QtyPill
                                        value={on ? l.qty_non_passed : 0}
                                        disabled={!on}
                                        invalid={!!err}
                                        min={0}
                                        onChange={(v) =>
                                          patchLine(id, b.bin_id!, {
                                            qty_non_passed: v,
                                          })
                                        }
                                      />
                                      {err && (
                                        <div className="mt-1 text-xs text-red-600">
                                          {err}
                                        </div>
                                      )}
                                    </td>
                                  </>
                                ) : qtyMode === "auto_negative" ? (
                                  <td>
                                    <span className="font-bold text-red-600">
                                      {fmt(
                                        on
                                          ? l.qty_adjustment
                                          : (b.suggested_qty_adjustment ?? 0),
                                      )}
                                    </span>
                                    <div className="text-xs text-neutral-400">
                                      Automatic
                                    </div>
                                  </td>
                                ) : (
                                  <td>
                                    <QtyPill
                                      value={on ? l.qty_adjustment : 0}
                                      disabled={!on}
                                      invalid={!!err}
                                      min={-usable(b)}
                                      onChange={(v) =>
                                        patchLine(id, b.bin_id!, {
                                          qty_adjustment: v,
                                        })
                                      }
                                    />
                                    {err && (
                                      <div className="mt-1 text-xs text-red-600">
                                        {err}
                                      </div>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FR-IA-10: discrepancy references, Discrepancy types only. */}
      {rule?.discrepancy_list && groups.length > 0 && (
        <div className={CARD}>
          <SectionHead
            title="Discrepancy References"
            subtitle="Optional. Link the discrepancies this adjustment settles; they are sent to Oracle with the document number."
          />
          <div className="p-5">
            {discrepancies.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No {rule.discrepancy_list} discrepancy matches the selected
                materials and bins.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {discrepancies.map((d) => {
                  const on = selectedDiscs.has(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${on ? "border-[#5166AE] bg-[#F2F4FD]" : "border-neutral-200 hover:bg-neutral-50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSelectedDiscs((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.id)) next.delete(d.id);
                            else next.add(d.id);
                            return next;
                          })
                        }
                        className="h-4 w-4 rounded border-neutral-300 accent-[#5166AE]"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-neutral-900">
                          {d.discrepancy_id}
                        </span>
                        <span className="block text-xs capitalize text-neutral-500">
                          {d.from} · {d.type}
                          {!d.bin_matched && " · material match only"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sticky summary footer, once something is picked. */}
      {groups.length > 0 && (
        <div className="sticky bottom-4 z-30">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 shadow-[0_-4px_24px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <Summary
                label="Warehouse:"
                value={
                  <span className="block max-w-[180px] truncate">
                    {warehouseSummary}
                  </span>
                }
              />
              <span className="text-neutral-300">|</span>
              <Summary label="Materials:" value={groups.length} />
              <span className="text-neutral-300">|</span>
              <Summary label="Bins:" value={filledBins} />
              <span className="text-neutral-300">|</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">
                  Total Adjustment:
                </span>
                <span className="text-base font-bold text-[#5166AE]">
                  {fmt(totalAdjustment)}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              {blocking && (
                <span className="hidden text-xs text-neutral-500 xl:inline">
                  {blocking}
                </span>
              )}
              <button
                type="button"
                onClick={() => navigate(BASE)}
                className="h-10 rounded-lg border border-neutral-300 bg-white px-5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!blocking}
                title={blocking || undefined}
                onClick={() => setReviewing(true)}
                className="h-10 rounded-lg bg-[#5166AE] px-5 text-sm font-semibold text-white hover:bg-[#41528c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit for Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FR-IA-12 rule 1: this confirmation is the submission. */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]"
            onClick={() => !saving && setReviewing(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-[520px] rounded-2xl bg-white p-7 shadow-[0_22px_60px_rgba(15,23,42,0.32)]"
          >
            <div className="text-xs text-neutral-500">
              Inventory Adjustment - Confirm Submit
            </div>
            <h2 className="mt-2 text-xl font-semibold text-neutral-900">
              Submit for approval?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              The adjustment goes to a manager for approval and cannot be edited
              afterwards. Stock changes only once it is approved
              {rule?.oracle_hit === "always" ? " and Oracle approves it" : ""}.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-neutral-50 p-4 text-sm ring-1 ring-neutral-200">
              <dt className="text-neutral-500">Type</dt>
              <dd className="font-medium text-neutral-900">{rule?.label}</dd>
              <dt className="text-neutral-500">Warehouse</dt>
              <dd className="font-medium text-neutral-900">
                {warehouseSummary}
              </dd>
              <dt className="text-neutral-500">Materials / Bins</dt>
              <dd className="font-medium text-neutral-900">
                {groups.length} / {picked.length}
              </dd>
              <dt className="text-neutral-500">Total Adjustment</dt>
              <dd className="font-bold text-[#5166AE]">
                {fmt(totalAdjustment)}
              </dd>
              {selectedDiscs.size > 0 && (
                <>
                  <dt className="text-neutral-500">Discrepancies</dt>
                  <dd className="font-medium text-neutral-900">
                    {selectedDiscs.size}
                  </dd>
                </>
              )}
            </dl>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                disabled={saving}
                className="h-10 rounded-lg border border-neutral-300 bg-white px-5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="h-10 rounded-lg bg-[#5166AE] px-5 text-sm font-semibold text-white hover:bg-[#41528c] disabled:opacity-50"
              >
                {saving ? "Submitting…" : "Yes, submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-neutral-800 dark:text-slate-200">
        {label} {required && <span className="text-red-500">*</span>}
      </div>
      {children}
    </div>
  );
}

function SectionHead({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-t-xl border-b border-neutral-200 bg-neutral-50/60 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/30">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] text-neutral-600 dark:text-slate-400">
          {subtitle}
        </p>
      </div>
      {right}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-900 dark:text-white">
        {value}
      </span>
    </span>
  );
}

/**
 * WMS dev's rounded – qty + pill. Takes a signed value: the text is kept as
 * typed so "-" or "1." can be entered on the way to a number.
 */
function QtyPill({
  value,
  onChange,
  min,
  disabled,
  invalid,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  const [lastValue, setLastValue] = useState(value);
  // Follow value changes made outside the input (– / +, unticking the bin).
  if (value !== lastValue) {
    setLastValue(value);
    if (Number(text) !== value) setText(value ? String(value) : "");
  }
  const set = (n: number) => {
    const v = min != null ? Math.max(min, n) : n;
    setText(v ? String(v) : "");
    setLastValue(v);
    onChange(v);
  };
  const btn =
    "flex h-full w-9 shrink-0 items-center justify-center text-lg text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div
      className={`relative inline-flex h-8 w-[130px] items-center overflow-hidden rounded-full border shadow-sm transition-all ${
        disabled
          ? "cursor-not-allowed border-neutral-200 bg-neutral-100 opacity-50"
          : invalid
            ? "border-red-400 bg-white"
            : "border-neutral-200 bg-white focus-within:border-[#5166AE]"
      }`}
    >
      <button
        type="button"
        className={btn}
        disabled={disabled || (min != null && value <= min)}
        onClick={() => set(value - 1)}
        aria-label="Decrease quantity"
      >
        –
      </button>
      <div className="relative flex h-full flex-1 items-center justify-center border-x border-neutral-200 bg-white">
        <input
          inputMode="decimal"
          disabled={disabled}
          placeholder="0"
          className="w-full bg-transparent px-1 text-center text-sm text-neutral-900 outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(",", ".");
            if (!/^-?\d*\.?\d*$/.test(raw)) return;
            setText(raw);
            const n = Number(raw);
            if (
              raw !== "" &&
              raw !== "-" &&
              raw !== "." &&
              Number.isFinite(n)
            ) {
              setLastValue(n);
              onChange(n);
            } else if (raw === "") {
              setLastValue(0);
              onChange(0);
            }
          }}
          onBlur={() => min != null && value < min && set(min)}
        />
      </div>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => set(value + 1)}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

/** "Pending N Docs (Q Qty)" with WMS dev's popover listing the documents. */
function PendingDocs({
  docs,
  total,
}: {
  docs: AdjPendingDoc[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 inline-flex select-none items-center gap-1 rounded-md border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100/80"
      >
        Pending {docs.length} Doc{docs.length === 1 ? "" : "s"} ({fmt(total)}{" "}
        Qty)
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-900">
              Pending Adjustments
            </span>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Total {fmt(total)} Qty
            </span>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {docs.map((d) => (
              <li key={`${d.id}-${d.qty}`}>
                <a
                  href={`${BASE}/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-[#5166AE]">
                        {d.adjustment_number}
                      </span>
                      <span className="rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">
                        {fmt(d.qty)} Qty
                      </span>
                    </span>
                    <span className="block pl-3 text-xs text-neutral-500">
                      {adjStatusLabel(d.status)} • by {d.created_by ?? "-"}
                    </span>
                  </span>
                  <span className="mt-0.5 text-neutral-400">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4"
                      />
                    </svg>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
