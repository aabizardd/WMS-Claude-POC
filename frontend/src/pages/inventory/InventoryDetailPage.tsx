import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import api from "../../lib/api";
import type { BinOption, InventoryDetail } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useConfirm } from "../../context/ConfirmContext";
import NumberInput from "../../components/NumberInput";
import SearchableSelect from "../../components/SearchableSelect";

// One editable row in the bin-adjustment table.
interface EditRow {
  key: string; // stable react key
  bin_id: string | null; // null = "no bin" bucket
  bin_location: string | null;
  avail_qty: number;
  isNew: boolean;
}

let rowSeq = 0;
const nextKey = () => `row-${rowSeq++}`;

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canAdjust = has("inventory:update");

  const [inv, setInv] = useState<InventoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // --- adjustment state ---
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
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startEdit() {
    if (!inv) return;
    setRows(
      inv.bins.map((b) => ({
        key: nextKey(),
        bin_id: b.bin_id,
        bin_location: b.bin_location,
        avail_qty: b.avail_qty,
        isNew: false,
      })),
    );
    setEditing(true);
    // Load bins for this warehouse for the "Add BIN" picker.
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
    setEditing(false);
    setRows([]);
  }

  const target = inv?.avail_qty ?? 0;
  const currentTotal = rows.reduce((a, r) => a + (r.avail_qty || 0), 0);
  const remaining = target - currentTotal;

  const usedBinIds = new Set(
    rows.map((r) => r.bin_id).filter(Boolean) as string[],
  );
  const hasUnpicked = rows.some((r) => r.isNew && !r.bin_id);
  const hasNegative = rows.some((r) => r.avail_qty < 0);
  const isValid = Math.abs(remaining) < 1e-9 && !hasUnpicked && !hasNegative;

  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        key: nextKey(),
        bin_id: null,
        bin_location: null,
        avail_qty: 0,
        isNew: true,
      },
    ]);
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function setQty(key: string, v: number) {
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, avail_qty: v } : r)),
    );
  }
  function pickBin(key: string, binId: string) {
    const opt = binOptions.find((o) => o.id === binId);
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, bin_id: binId, bin_location: opt?.binLabel ?? binId }
          : r,
      ),
    );
  }

  async function save() {
    if (!inv || !isValid) return;
    const ok = await confirm({
      title: "Save bin adjustment?",
      description:
        "Available quantity will be redistributed across the bins as entered.",
      type: "info",
      confirmText: "Save",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const r = await api.patch<InventoryDetail>(`/inventory/${inv.id}/bins`, {
        bins: rows.map((row) => ({
          bin_id: row.bin_id,
          avail_qty: row.avail_qty,
        })),
      });
      setInv(r.data);
      setEditing(false);
      setRows([]);
      toast.success("Bin quantities updated");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(
          Array.isArray(msg) ? msg.join(", ") : (msg ?? "Update failed"),
        );
      } else toast.error("Update failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
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

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/admin/inventory/list"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {inv.material_name ?? inv.material_code}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {inv.material_code} · {inv.warehouse_name ?? "No warehouse"}
          </p>
        </div>
      </div>

      {/* Header info + aggregate quantities */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Material
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Material Name" value={inv.material_name} />
          <Meta label="Material Code" value={inv.material_code} />
          <Meta label="Type" value={inv.material_type} />
          <Meta label="Category" value={inv.material_category} />
          <Meta label="Primary UoM" value={inv.primary_uom} />
          <Meta label="Warehouse" value={inv.warehouse_name} />
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="On Hand" value={inv.on_hand} highlight />
          <Stat label="Reserved" value={inv.reserved_qty} />
          <Stat label="Available" value={inv.avail_qty} />
          <Stat label="In Transit" value={inv.in_transit_qty} />
          <Stat label="Quality Issue" value={inv.quality_issue} />
          <Stat label="Qty Issue" value={inv.qty_issue} />
        </div>
        {/* Oracle-mirrored quantities (header level) */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Committed (Oracle)" value={inv.qty_committed} />
          <Stat label="On Order (Oracle)" value={inv.qty_on_order} />
          <Stat label="Back Order (Oracle)" value={inv.qty_back_order} />
        </div>
      </div>

      {/* Grouped by bin location */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            By Bin Location{" "}
            {editing ? `(${rows.length})` : `(${inv.bins.length})`}
          </h3>
          {canAdjust && !editing && (
            <button className="btn-secondary" onClick={startEdit}>
              Adjust Bins
            </button>
          )}
        </div>

        {editing ? (
          <div className="p-5">
            {/* totals summary */}
            <div className="mb-4 grid grid-cols-3 gap-3">
              <SummaryStat label="Total Available" value={target} />
              <SummaryStat label="Allocated" value={currentTotal} />
              <SummaryStat
                label="Remaining"
                value={remaining}
                tone={Math.abs(remaining) < 1e-9 ? "ok" : "warn"}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Bin Location</th>
                    <th className="px-4 py-3 text-right">Qty Available</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const opts = binOptions
                      .filter((o) => o.id === r.bin_id || !usedBinIds.has(o.id))
                      .map((o) => ({
                        value: o.id,
                        label: `${o.binLabel} (${o.binCode})`,
                      }));
                    return (
                      <tr key={r.key}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {r.isNew ? (
                            <SearchableSelect
                              value={r.bin_id ?? ""}
                              onChange={(v) => pickBin(r.key, v)}
                              options={opts}
                              placeholder="Select bin…"
                              className="w-64"
                            />
                          ) : (
                            (r.bin_location ?? "— (no bin)")
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <NumberInput
                              value={r.avail_qty}
                              onChange={(v) => setQty(r.key, v)}
                              min={0}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <button
                              onClick={() => removeRow(r.key)}
                              className="rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-slate-400"
                      >
                        No bins. Add a bin to allocate the available quantity.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button className="btn-secondary" onClick={addRow}>
                + Add BIN
              </button>
              <div className="flex items-center gap-3">
                {!isValid && (
                  <span className="text-xs text-amber-600">
                    {hasUnpicked
                      ? "Select a bin for every new row."
                      : hasNegative
                        ? "Quantity cannot be negative."
                        : `Total must equal ${target} (off by ${remaining > 0 ? "+" : ""}${remaining}).`}
                  </span>
                )}
                <button
                  className="btn-secondary"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={save}
                  disabled={!isValid || saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Bin Location</th>
                  <th className="px-5 py-3">Warehouse</th>
                  <th className="px-5 py-3 text-right">On Hand</th>
                  {/* <th className="px-5 py-3 text-right">Reserved</th> */}
                  <th className="px-5 py-3 text-right">Avail</th>
                  {/* <th className="px-5 py-3 text-right">In Transit</th> */}
                  <th className="px-5 py-3 text-right">Qlty Issue</th>
                  <th className="px-5 py-3 text-right">Qty Issue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inv.bins.map((b, i) => (
                  <tr
                    key={b.bin_id ?? `no-bin-${i}`}
                    className="hover:bg-slate-50"
                  >
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {b.bin_location ?? "— (no bin)"}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {b.warehouse_name ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">
                      {b.on_hand}
                    </td>
                    {/* <td className="px-5 py-3 text-right text-slate-600">
                      {b.reserved_qty}
                    </td> */}
                    <td className="px-5 py-3 text-right text-slate-600">
                      {b.avail_qty}
                    </td>
                    {/* <td className="px-5 py-3 text-right text-slate-600">
                      {b.in_transit_qty}
                    </td> */}
                    <td className="px-5 py-3 text-right text-slate-600">
                      {b.quality_issue}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {b.qty_issue}
                    </td>
                  </tr>
                ))}
                {inv.bins.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-8 text-center text-slate-400"
                    >
                      No stock in any bin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">
        {value || <span className="text-slate-300">—</span>}
      </dd>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        highlight
          ? "border-brand-200 bg-brand-50"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`text-lg font-semibold ${
          highlight ? "text-brand-700" : "text-slate-800"
        }`}
      >
        {value}
      </div>
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
    <div className={`rounded-lg border px-3 py-2 ${toneCls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
