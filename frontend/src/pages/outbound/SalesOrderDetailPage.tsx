import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import api from "../../lib/api";
import GeneratePickingModal, {
  type PickAllocation,
} from "../../components/GeneratePickingModal";
import { useAuth } from "../../context/AuthContext";
import {
  deliveryStatusBadgeClass,
  deliveryStatusLabel,
} from "../../lib/outboundStatus";
import type { Pickable, SalesOrderDetail } from "../../types";

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
    } catch {
      setGenError("Failed to load picking data.");
    } finally {
      setGenLoading(false);
    }
  }

  async function handleGenerate(allocations: PickAllocation[]) {
    setSubmitting(true);
    try {
      const payload = {
        salesOrderId: id,
        items: allocations.map((a) => ({
          salesOrderItemId: a.itemId,
          requestQty: a.qty,
          binId: a.binId,
          pickerId: a.pickerId,
        })),
      };
      const r = await api.post<{ picking_id: string }>("/picking/generate", payload);
      setGenOpen(false);
      setSuccessMsg(`Picking generated: ${r.data.picking_id}`);
      loadSo();
    } catch (err) {
      let msg = "Generate failed";
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(", ") : m ?? msg;
      }
      throw new Error(msg);
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

      <GeneratePickingModal
        open={genOpen}
        loading={genLoading}
        submitting={submitting}
        pickable={pickable}
        pickers={pickers}
        loadError={genError}
        onClose={() => setGenOpen(false)}
        onSubmit={handleGenerate}
      />
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
