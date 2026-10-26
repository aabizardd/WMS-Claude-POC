import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { DeliveryDetail, ShipmentResult } from '../../types';
import TablePager from '../../components/TablePager';
import ToolbarMenu, { ExportIcon, PrintIcon } from '../../components/ToolbarMenu';
import { deliveryStatusPill, formatDateTime } from './deliveryColumns';
import { deleteOutboundDoc } from './outboundDelete';

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const canShip = has('delivery:update');
  const canDelete = has('delivery:delete');

  const [dl, setDl] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState('');

  // Material List: searched and paged on the client.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  function load() {
    setLoading(true);
    api
      .get<DeliveryDetail>(`/delivery/${id}`)
      .then((r) => setDl(r.data))
      .catch(() => setLoadError('Failed to load Delivery.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runShipment() {
    setShipError('');
    setShipping(true);
    try {
      // Submits an Item Fulfillment to Oracle; SDO ID is filled only on success.
      const r = await api.put<ShipmentResult>(`/delivery/${id}/generate-shipment`, {});
      const f = r.data.fulfillment;
      toast.success(
        `${f?.message ?? 'Shipment generated'}${f?.fulfillment_id ? ` (Fulfillment #${f.fulfillment_id})` : ''} — SDO ${r.data.sdo_id}`,
      );
      setDl(r.data);
    } catch (err) {
      let msg = 'Generate failed';
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        msg = Array.isArray(m) ? m.join(', ') : m ?? msg;
      }
      setShipError(msg);
      toast.error(msg);
    } finally {
      setShipping(false);
    }
  }

  async function handleGenerateShipment() {
    const ok = await confirm({
      title: 'Generate Shipment?',
      description:
        'An Item Fulfillment will be submitted to Oracle. On success an SDO ID is generated and the delivery is Closed (moved to History). This cannot be undone.',
      type: 'info',
      confirmText: 'Generate Shipment',
    });
    if (!ok) return;
    await runShipment();
  }

  const items = useMemo(() => dl?.items ?? [], [dl]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        (it.material_code ?? '').toLowerCase().includes(q) ||
        (it.material_name ?? '').toLowerCase().includes(q) ||
        (it.bin_label ?? '').toLowerCase().includes(q) ||
        (it.picked_bins ?? []).some((b) => b.toLowerCase().includes(q)),
    );
  }, [items, search]);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  if (loading && !dl) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (loadError || !dl) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Delivery not found.'}
        </div>
        <Link to="/admin/outbound/sales-order/delivery" className="btn-secondary">
          ← Back to Delivery Plan
        </Link>
      </div>
    );
  }

  const isTransfer = dl.source_type === 'TRANSFER_ORDER';
  // Packings this delivery covers; the API lists them, older payloads carry one.
  const packingCodes =
    dl.packing_codes?.length ? dl.packing_codes : dl.packing_id ? [dl.packing_id] : [];
  const basePath = isTransfer ? '/admin/outbound/transfer-stock' : '/admin/outbound/sales-order';
  const sourceLink = isTransfer
    ? dl.to_id && `/admin/outbound/transfer-stock/list/${dl.to_id}`
    : dl.so_id && `/admin/outbound/sales-order/list/${dl.so_id}`;
  const notYet = () => toast.info('This is not available yet.');

  return (
    <div className="card p-5">
      {/* Blocking loading overlay while hitting the Oracle fulfillment API */}
      {shipping && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-8 py-6 shadow-xl">
            <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div className="text-sm font-medium text-slate-700">
              Submitting Item Fulfillment to Oracle…
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`${basePath}/delivery`}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Delivery Plan Detail</h1>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarMenu
            items={[
              { label: 'Print', icon: <PrintIcon />, onClick: () => navigate(`${basePath}/delivery/${dl.id}/print`) },
              { label: 'Export', icon: <ExportIcon />, onClick: notYet },
            ]}
          />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
            onClick={load}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
            </svg>
          </button>
          {canDelete && dl.status === 'Open' && !dl.sdo_id && (
            <button
              className="btn-secondary text-red-600 hover:bg-red-50"
              disabled={shipping}
              onClick={async () => {
                if (await deleteOutboundDoc('delivery', dl.id, dl.delivery_id, confirm, toast))
                  navigate(`${basePath}/delivery`);
              }}
            >
              Delete
            </button>
          )}
          {canShip && dl.status !== 'Closed' && (
            <button className="btn-primary" onClick={handleGenerateShipment} disabled={shipping}>
              {shipping ? 'Generating…' : 'Generate Shipment'}
            </button>
          )}
        </div>
      </div>

      {/* Fulfillment failure — allow retry */}
      {shipError && dl.status !== 'Closed' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div>
            <span className="font-semibold">Shipment failed:</span> {shipError}
          </div>
          {canShip && (
            <button className="btn-primary" onClick={runShipment} disabled={shipping}>
              {shipping ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm lg:grid-cols-4">
          <Info label="Status" value={deliveryStatusPill(dl.status)} />
          <Info
            label="Transaction ID"
            value={
              sourceLink ? (
                <Link to={sourceLink} className="text-brand-700 hover:underline">
                  {dl.source_number ?? '-'}
                </Link>
              ) : (
                dl.source_number
              )
            }
          />
          <Info label="SD Number" value={dl.sdo_id} />
          <Info label="Delivery ID" value={dl.delivery_id} />
          <Info
            label="Packing ID"
            value={
              <span className="inline-flex items-center gap-1.5">
                {dl.packing_db_id ? (
                  <Link
                    to={`${basePath}/packing/${dl.packing_db_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {dl.packing_id}
                  </Link>
                ) : (
                  (dl.packing_id ?? '-')
                )}
                {/*
                  A delivery can cover several packings. The first one is named;
                  the rest sit behind a badge whose tooltip lists them all, so
                  the header stays short. Each line names its own below.
                */}
                {packingCodes.length > 1 && (
                  <span
                    className="cursor-help rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700"
                    title={`Covers ${packingCodes.length} packings:\n${packingCodes.join('\n')}`}
                  >
                    +{packingCodes.length - 1}
                  </span>
                )}
              </span>
            }
          />
          <Info label="Doc Type" value="Delivery Plan" />
          <Info label="Ownership" value={dl.ownership} />
          <Info label="Warehouse Name" value={dl.location} />
          <Info label={isTransfer ? 'Destination' : 'Customer Name'} value={dl.customer} />
          <Info label="Created By" value={dl.created_by} />
          <Info label="Created At" value={formatDateTime(dl.created_at)} />
          <Info label="Last Modified By" value={dl.updated_by} />
          <Info label="Last Modified At" value={formatDateTime(dl.updated_at)} />
        </dl>
      </div>

      {/* Material List */}
      <h3 className="mb-3 mt-6 text-base font-semibold text-slate-800">Material List</h3>
      <div className="relative mb-3 w-full max-w-xs">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          className="input pl-9"
          placeholder="Search..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                <th>No</th>
                <th>Packing ID</th>
                <th>Material Code</th>
                <th>Material Name</th>
                <th className="text-right">ERP Line</th>
                <th className="text-right">Quantity</th>
                <th>UOM</th>
                <th>Staging Bin</th>
                <th>Picking Bin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((it, i) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {it.packing_code ?? dl.packing_id ?? '-'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-800">{it.material_code ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{it.material_name ?? '-'}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{it.line_number ?? '-'}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{it.qty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{it.uom ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{it.bin_label ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{it.picked_bins?.join(', ') || '-'}</td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    {search ? 'No material matches the search.' : 'No items.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager
          page={page}
          pageSize={pageSize}
          total={filtered.length}
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

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-700">{label}</dt>
      <dd className="mt-1 text-slate-700">
        {value === null || value === undefined || value === '' ? '-' : value}
      </dd>
    </div>
  );
}
