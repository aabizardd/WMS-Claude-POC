import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import api from "../../lib/api";
import Modal from "../../components/Modal";
import SearchableSelect from "../../components/SearchableSelect";
import { useAuth } from "../../context/AuthContext";
import {
  deliveryStatusBadgeClass,
  deliveryStatusLabel,
} from "../../lib/outboundStatus";
import type { Pickable, SalesOrderDetail } from "../../types";

interface ItemForm {
  selected: boolean;
  qty: number;
  binId: string;
  pickerId: string;
}

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const canGenerate = has("picking:create");

  const [so, setSo] = useState<SalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Generate Picking modal state.
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [pickable, setPickable] = useState<Pickable | null>(null);
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [forms, setForms] = useState<Record<string, ItemForm>>({});

  function loadSo() {
    setLoading(true);
    api
      .get<SalesOrderDetail>(`/sales-orders/${id}`)
      .then((r) => setSo(r.data))
      .catch(() => setLoadError("Failed to load Sales Order."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<SalesOrderDetail>(`/sales-orders/${id}`)
      .then((r) => active && setSo(r.data))
      .catch(() => active && setLoadError("Failed to load Sales Order."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function openGenerate() {
    setGenError("");
    setSuccessMsg("");
    setGenOpen(true);
    setGenLoading(true);
    try {
      const [p, pk] = await Promise.all([
        api.get<Pickable>(`/picking/pickable/${id}`),
        api.get<{ id: number; name: string }[]>("/users/pickers", {
          params: { warehouseId: so?.warehouse?.id ?? undefined },
        }),
      ]);
      setPickable(p.data);
      setPickers(pk.data);
      setForms(
        Object.fromEntries(
          p.data.items.map((it) => [
            it.id,
            {
              selected: false,
              qty: it.remaining_qty,
              binId: it.available_bins[0]?.bin_id ?? "",
              pickerId: "",
            } as ItemForm,
          ]),
        ),
      );
    } catch {
      setGenError("Failed to load picking data.");
    } finally {
      setGenLoading(false);
    }
  }

  function patchForm(itemId: string, patch: Partial<ItemForm>) {
    setForms((f) => ({ ...f, [itemId]: { ...f[itemId], ...patch } }));
  }

  async function handleGenerate() {
    if (!pickable) return;
    setGenError("");
    const chosen = pickable.items.filter((it) => forms[it.id]?.selected);
    if (chosen.length === 0) {
      setGenError("Select at least one item.");
      return;
    }
    for (const it of chosen) {
      const f = forms[it.id];
      if (!(f.qty > 0) || f.qty > it.remaining_qty) {
        setGenError(`Invalid qty for "${it.item_name ?? it.material_code}".`);
        return;
      }
      if (!f.binId) {
        setGenError(`Bin source is required for "${it.item_name ?? it.material_code}".`);
        return;
      }
      if (!f.pickerId) {
        setGenError(`Picker is required for "${it.item_name ?? it.material_code}".`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        salesOrderId: id,
        items: chosen.map((it) => ({
          salesOrderItemId: it.id,
          requestQty: Number(forms[it.id].qty),
          binId: forms[it.id].binId,
          pickerId: Number(forms[it.id].pickerId),
        })),
      };
      const r = await api.post<{ picking_id: string }>("/picking/generate", payload);
      setGenOpen(false);
      setSuccessMsg(`Picking generated: ${r.data.picking_id}`);
      loadSo();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setGenError(Array.isArray(msg) ? msg.join(", ") : msg ?? "Generate failed");
      } else setGenError("Generate failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (loadError || !so) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || "Sales Order not found."}
        </div>
        <Link to="/admin/outbound/sales-order/list" className="btn-secondary">
          ← Back to Outbound
        </Link>
      </div>
    );
  }

  // SO statuses that still allow generating a picking (remaining = qty - shipped).
  const PICKABLE_STATUSES = [
    "Pending Fulfillment",
    "Pending Billing/Partially Fulfilled",
  ];
  const showGenerate =
    canGenerate && PICKABLE_STATUSES.includes(so.status_name ?? "");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/outbound/sales-order/list"
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
              {so.tran_id ?? so.oracle_id}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {so.customer_name ?? "—"} · {so.location_name ?? "No location"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${deliveryStatusBadgeClass(
              so.delivery_status,
            )}`}
          >
            {deliveryStatusLabel(so.delivery_status)}
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            {so.status_name ?? "—"}
          </span>
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {successMsg}
        </div>
      )}

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Sales Order Information
          </h3>
          {showGenerate && (
            <button className="btn-primary" onClick={openGenerate}>
              Generate Picking
            </button>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="SO Number" value={so.tran_id} />
          <Meta label="Oracle ID" value={so.oracle_id} />
          <Meta label="Customer" value={so.customer_name} />
          <Meta label="Location" value={so.location_name} />
          <Meta label="Delivery Status" value={deliveryStatusLabel(so.delivery_status)} />
          <Meta label="Subsidiary" value={so.subsidiary_name} />
          <Meta label="Currency" value={so.currency_name} />
          <Meta label="Total Amount" value={so.total_amount.toLocaleString()} />
          <Meta label="Transaction Date" value={so.tran_date} />
          <Meta label="Date Created" value={so.date_created} />
          <Meta label="Memo" value={so.memo} />
        </dl>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Items
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Line Number</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">Material Code</th>
                <th className="px-5 py-3 text-right">Quantity</th>
                <th className="px-5 py-3 text-right">Remaining</th>
                <th className="px-5 py-3 text-right">Rate</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3 text-right">Shipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {so.items.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-600">{it.line_number}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">
                      {it.item_name ?? "—"}
                    </div>
                    {it.description && (
                      <div className="text-xs text-slate-400">
                        {it.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {it.material_code ?? (
                      <span className="text-slate-300">unmatched</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.quantity}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.remaining_qty}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.rate.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.amount.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">
                    {it.shipped}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={genOpen}
        title="Generate Picking"
        onClose={() => (submitting ? null : setGenOpen(false))}
      >
        <div className="space-y-4">
          {genError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {genError}
            </div>
          )}
          {genLoading ? (
            <div className="py-6 text-center text-sm text-slate-400">
              Loading picking data…
            </div>
          ) : !pickable || pickable.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">
              No items with remaining quantity to pick.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-500">
                Select items, quantity, bin source, and picker. Partial item and
                partial qty are supported; qty cannot exceed remaining.
              </p>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {pickable.items.map((it) => {
                  const f = forms[it.id];
                  if (!f) return null;
                  return (
                    <div
                      key={it.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={f.selected}
                          onChange={(e) =>
                            patchForm(it.id, { selected: e.target.checked })
                          }
                        />
                        {it.item_name ?? it.material_code ?? "—"}
                        <span className="text-xs font-normal text-slate-400">
                          ({it.material_code ?? "unmatched"}) · Remaining:{" "}
                          {it.remaining_qty}
                        </span>
                      </label>
                      {f.selected && (
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <label className="block text-xs text-slate-400">
                              Qty
                            </label>
                            <input
                              type="number"
                              step="any"
                              min={0}
                              max={it.remaining_qty}
                              className="input mt-0.5 w-full text-right text-sm"
                              value={f.qty}
                              onChange={(e) =>
                                patchForm(it.id, { qty: Number(e.target.value) })
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400">
                              Bin Source
                            </label>
                            <SearchableSelect
                              className="mt-0.5"
                              value={f.binId}
                              onChange={(v) => patchForm(it.id, { binId: v })}
                              placeholder="— Select —"
                              searchPlaceholder="Search bin…"
                              options={it.available_bins.map((b) => ({
                                value: b.bin_id ?? '',
                                label: `${b.bin_label ?? '—'} (avail ${b.avail_qty})`,
                              }))}
                            />
                            {it.available_bins.length === 0 && (
                              <p className="mt-1 text-[11px] text-amber-600">
                                No bin with stock for this material.
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400">
                              Picker
                            </label>
                            <SearchableSelect
                              className="mt-0.5"
                              value={f.pickerId}
                              onChange={(v) => patchForm(it.id, { pickerId: v })}
                              placeholder="— Select —"
                              searchPlaceholder="Search picker…"
                              options={pickers.map((p) => ({
                                value: String(p.id),
                                label: p.name,
                              }))}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setGenOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={submitting || genLoading || !pickable || pickable.items.length === 0}
            >
              {submitting ? "Generating…" : "Generate Picking"}
            </button>
          </div>
        </div>
      </Modal>
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
