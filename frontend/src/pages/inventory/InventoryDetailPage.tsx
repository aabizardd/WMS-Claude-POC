import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import api from "../../lib/api";
import type {
  BinOption,
  InventoryDetail,
  InventoryTransfer,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import SearchableSelect from "../../components/SearchableSelect";
import QtyStepper from "../../components/QtyStepper";
import TablePager from "../../components/TablePager";
import InventoryBinTable from "./InventoryBinTable";
import QtySourceLink from "./QtySourceLink";

// One editable row in the Transfer Bins allocation table.
interface EditRow {
  key: string; // stable react key
  bin_id: string | null; // null = "no bin" bucket
  bin_code: string | null;
  bin_label: string | null;
  avail_qty: number;
  isNew: boolean;
}

let rowSeq = 0;
const nextKey = () => `row-${rowSeq++}`;
const EPS = 1e-9;

const fmt = (n: number) => n.toLocaleString();

/** "2026-10-14 11:54" in Jakarta time, the way the warehouse reads it. */
function formatWib(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

type Tab = "bins" | "history";

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has, user } = useAuth();
  const toast = useToast();
  const canAdjust = has("inventory:update");

  const [inv, setInv] = useState<InventoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("bins");

  // Bin List: searched and paged on the client (one material, few bins).
  const [binSearch, setBinSearch] = useState("");
  const [binPage, setBinPage] = useState(1);
  const [binPageSize, setBinPageSize] = useState(10);

  // Transfer History
  const [history, setHistory] = useState<InventoryTransfer[] | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  // Transfer Bins: a warning first, then the allocation editor.
  const [warning, setWarning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [binOptions, setBinOptions] = useState<BinOption[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api
      .get<InventoryDetail>(`/inventory/${id}`)
      .then((r) => setInv(r.data))
      .catch(() => setError("Failed to load inventory."))
      .finally(() => setLoading(false));
  }
  function loadHistory() {
    api
      .get<InventoryTransfer[]>(`/inventory/${id}/transfers`)
      .then((r) => setHistory(r.data))
      .catch(() => setHistory([]));
  }
  useEffect(() => {
    load();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function refresh() {
    load();
    loadHistory();
  }

  // ----- Bin List -----

  const filteredBins = useMemo(() => {
    const bins = inv?.bins ?? [];
    const q = binSearch.trim().toLowerCase();
    if (!q) return bins;
    return bins.filter(
      (b) =>
        (b.bin_code ?? "").toLowerCase().includes(q) ||
        (b.bin_location ?? "").toLowerCase().includes(q),
    );
  }, [inv, binSearch]);
  const pagedBins = filteredBins.slice(
    (binPage - 1) * binPageSize,
    binPage * binPageSize,
  );

  const pagedHistory = (history ?? []).slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );

  // ----- Transfer Bins -----

  async function startEdit() {
    if (!inv) return;
    setWarning(false);
    setRows(
      // Frozen (KIT) bins are left out: their stock is Freeze Qty, not
      // Available, and the server refuses to edit them here.
      inv.bins
        .filter((b) => !b.is_frozen)
        .map((b) => ({
          key: nextKey(),
          bin_id: b.bin_id,
          bin_code: b.bin_code ?? null,
          bin_label: b.bin_location,
          avail_qty: b.avail_qty,
          isNew: false,
        })),
    );
    setEditing(true);
    // Load bins for this warehouse for the "Add Bin" picker.
    if (inv.warehouse_id) {
      try {
        const r = await api.get<BinOption[]>("/bins/options", {
          params: { warehouseId: inv.warehouse_id },
        });
        setBinOptions(r.data);
      } catch {
        setBinOptions([]);
      }
    }
  }

  function cancelEdit() {
    if (saving) return;
    setEditing(false);
    setRows([]);
  }

  const target = inv?.avail_qty ?? 0;
  const currentTotal = rows.reduce((a, r) => a + (r.avail_qty || 0), 0);
  const remaining = target - currentTotal;

  const usedBinIds = new Set(rows.map((r) => r.bin_id).filter(Boolean) as string[]);
  const hasUnpicked = rows.some((r) => r.isNew && !r.bin_id);
  const hasNegative = rows.some((r) => r.avail_qty < 0);
  const isValid = Math.abs(remaining) < EPS && !hasUnpicked && !hasNegative;

  function addRow() {
    setRows((rs) => [
      ...rs,
      { key: nextKey(), bin_id: null, bin_code: null, bin_label: null, avail_qty: 0, isNew: true },
    ]);
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function setQty(key: string, v: number) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, avail_qty: v } : r)));
  }
  function stepQty(key: string, delta: number) {
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, avail_qty: Math.max(0, (r.avail_qty || 0) + delta) } : r,
      ),
    );
  }
  function pickBin(key: string, binId: string) {
    const opt = binOptions.find((o) => o.id === binId);
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, bin_id: binId, bin_code: opt?.binCode ?? null, bin_label: opt?.binLabel ?? binId }
          : r,
      ),
    );
  }

  async function save() {
    if (!inv || !isValid || saving) return;
    setSaving(true);
    try {
      const r = await api.patch<InventoryDetail>(`/inventory/${inv.id}/bins`, {
        bins: rows.map((row) => ({ bin_id: row.bin_id, avail_qty: row.avail_qty })),
      });
      setInv(r.data);
      setEditing(false);
      setRows([]);
      loadHistory();
      toast.success("Bin allocation updated");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(", ") : (msg ?? "Update failed"));
      } else toast.error("Update failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !inv) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>;
  }
  if (error || !inv) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Inventory not found."}
        </div>
        <Link to="/admin/inventory/list" className="btn-secondary">
          ← Back to inventory
        </Link>
      </div>
    );
  }

  const materialLabel = inv.material_name ?? inv.material_code;

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/inventory/list"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Inventory Details</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
            onClick={refresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
            </svg>
          </button>
          {canAdjust && (
            <button className="btn-primary" onClick={() => setWarning(true)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
              Transfer Bins
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Info label="Material Name" value={inv.material_name} />
          <Info label="Material Code" value={inv.material_code} />
          <Info label="ERP Doc ID" value={inv.erp_doc_id} />
          <Info label="Material Type" value={inv.material_type} />
          <Info label="Category" value={inv.material_category} />
          <Info label="Warehouse" value={inv.warehouse_name} />
          <Info label="UoM" value={inv.primary_uom} />
          <Info label="Stock on Hand" value={fmt(inv.on_hand)} />
          <Info
            label="Available Quantity"
            value={fmt(inv.avail_qty)}
            hint={
              inv.freeze_qty > 0
                ? `${fmt(inv.avail_in_bins)} in bins − ${fmt(inv.freeze_qty)} frozen`
                : undefined
            }
          />
          <Info label="Freeze Quantity" value={fmt(inv.freeze_qty)} />
          <Info label="Quantity Issue" value={fmt(inv.qty_issue)} />
          <Info label="Quality Issue" value={fmt(inv.quality_issue)} />
          <Info
            label="Reserved Quantity"
            value={<QtySourceLink inventoryId={inv.id} type="reserved" qty={inv.reserved_qty} />}
          />
          <Info
            label="In Transit Quantity"
            value={<QtySourceLink inventoryId={inv.id} type="in-transit" qty={inv.in_transit_qty} />}
          />
        </dl>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-6 border-b border-slate-200">
        {(
          [
            ["bins", "Bin List"],
            ["history", "Transfer History"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition ${
              tab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "bins" ? (
        <div className="mt-4 space-y-3">
          <div className="relative w-full max-w-xs">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <input
              className="input pl-9"
              placeholder="Search..."
              value={binSearch}
              onChange={(e) => {
                setBinSearch(e.target.value);
                setBinPage(1);
              }}
            />
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <InventoryBinTable
                bins={pagedBins}
                startNo={(binPage - 1) * binPageSize + 1}
                emptyText={binSearch ? "No bin matches the search." : "No stock in any bin."}
              />
            </div>
            <TablePager
              page={binPage}
              pageSize={binPageSize}
              total={filteredBins.length}
              onPage={setBinPage}
              onPageSize={(n) => {
                setBinPageSize(n);
                setBinPage(1);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-semibold">
                  <th>No</th>
                  <th>Date &amp; Time (WIB)</th>
                  <th>From Bin</th>
                  <th />
                  <th>To Bin</th>
                  <th className="text-right">Quantity</th>
                  <th>Adjusted By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history === null ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td>
                  </tr>
                ) : pagedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No bin transfer recorded yet.
                    </td>
                  </tr>
                ) : (
                  pagedHistory.map((h, i) => (
                    <tr key={h.id}>
                      <td className="px-4 py-3 text-slate-500">
                        {(historyPage - 1) * historyPageSize + i + 1}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatWib(h.created_at)}</td>
                      <td className="px-4 py-3">
                        <BinCell code={h.from_bin.bin_code} label={h.from_bin.bin_label} />
                      </td>
                      <td className="px-1 py-3 text-slate-400">→</td>
                      <td className="px-4 py-3">
                        <BinCell code={h.to_bin.bin_code} label={h.to_bin.bin_label} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(h.qty)}</td>
                      <td className="px-4 py-3 text-slate-600">{h.adjusted_by ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePager
            page={historyPage}
            pageSize={historyPageSize}
            pageSizes={[10, 25, 50, 100]}
            total={history?.length ?? 0}
            onPage={setHistoryPage}
            onPageSize={(n) => {
              setHistoryPageSize(n);
              setHistoryPage(1);
            }}
          />
        </div>
      )}

      {/* Step 1 — what a transfer does, before any edit is possible. */}
      {warning && (
        <Overlay onClose={() => setWarning(false)} widthClass="max-w-md">
          <div className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-800">Transfer Bins</h3>
                <p className="text-xs text-slate-500">
                  You are about to change the bin allocation for {materialLabel}.
                </p>
              </div>
              <CloseButton onClick={() => setWarning(false)} />
            </div>
            <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
              {[
                "This moves physical stock allocation between bins. Make sure the goods have actually been moved in the warehouse.",
                "Only available quantity moves. Reserved, in transit, issue and frozen (KIT) quantities stay where they are.",
                "The total quantity must stay the same. This is a relocation, not a stock correction.",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {t}
                </li>
              ))}
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>
                  Every change is recorded in Transfer History under your name,{" "}
                  <b className="text-slate-800">{user?.username ?? user?.name ?? "you"}</b>, and
                  cannot be undone from this screen.
                </span>
              </li>
            </ul>
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button className="btn-secondary" onClick={() => setWarning(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={startEdit}>
                I Understand, Continue
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Step 2 — the allocation editor. */}
      {editing && (
        <Overlay onClose={cancelEdit} widthClass="max-w-4xl">
          <div className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-800">Transfer Bins Allocation</h3>
                <p className="text-xs text-slate-500">
                  Transfer available quantities across bins for {materialLabel}.
                </p>
              </div>
              <CloseButton onClick={cancelEdit} />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <SummaryStat label="Total Available" value={target} />
              <SummaryStat label="Allocated" value={currentTotal} />
              <SummaryStat
                label="Remaining"
                value={remaining}
                tone={Math.abs(remaining) < EPS ? "ok" : "warn"}
              />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <div className="max-h-[45vh] overflow-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                    <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                      <th className="w-12">No</th>
                      <th>Bin Code</th>
                      <th>Bin Label</th>
                      <th>Available Quantity</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => {
                      const opts = binOptions
                        .filter((o) => o.id === r.bin_id || !usedBinIds.has(o.id))
                        .map((o) => ({ value: o.id, label: `${o.binCode} - ${o.binLabel}` }));
                      return (
                        <tr key={r.key}>
                          <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                          <td className="px-4 py-2.5">
                            {r.isNew ? (
                              <SearchableSelect
                                value={r.bin_id ?? ""}
                                onChange={(v) => pickBin(r.key, v)}
                                options={opts}
                                placeholder="Select bin…"
                                searchPlaceholder="Search bin…"
                                className="w-72"
                              />
                            ) : (
                              <span className="font-medium text-slate-800">
                                {r.bin_code ?? (r.bin_id ? "—" : "— (no bin)")}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{r.bin_label ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <QtyStepper
                              value={r.avail_qty}
                              invalid={r.avail_qty < 0}
                              onChange={(v) => setQty(r.key, v)}
                              onStep={(d) => stepQty(r.key, d)}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeRow(r.key)}
                              className="rounded-md p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove bin"
                              title="Remove bin"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                          No bins. Add a bin to allocate the available quantity.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50"
              onClick={addRow}
            >
              + Add Bin
            </button>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
              {!isValid && (
                <span className="mr-auto text-xs text-amber-600">
                  {hasUnpicked
                    ? "Select a bin for every new row."
                    : hasNegative
                      ? "Quantity cannot be negative."
                      : `Allocated must equal ${fmt(target)} (off by ${remaining > 0 ? "+" : ""}${fmt(remaining)}).`}
                </span>
              )}
              <button className="btn-secondary" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={!isValid || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function BinCell({ code, label }: { code: string | null; label: string | null }) {
  return (
    <div>
      <div className="whitespace-nowrap font-medium text-slate-800">{code ?? "—"}</div>
      {label && <div className="whitespace-nowrap text-xs text-slate-400">{label}</div>}
    </div>
  );
}

function Info({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-800">
        {value === null || value === undefined || value === "" ? (
          <span className="text-slate-300">—</span>
        ) : (
          value
        )}
      </dd>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const toneCls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold">{fmt(value)}</div>
    </div>
  );
}

function Overlay({
  children,
  onClose,
  widthClass,
}: {
  children: ReactNode;
  onClose: () => void;
  widthClass: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`card relative z-10 w-full ${widthClass}`}>{children}</div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      aria-label="Close"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
