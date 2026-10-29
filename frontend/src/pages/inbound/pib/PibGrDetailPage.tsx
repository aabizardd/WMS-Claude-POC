import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../../lib/api';
import { printDoc } from '../../../lib/print';
import type { BinOption, GoodsReceiveItem, PibGrDetail, PibGrItem } from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../context/ConfirmContext';
import { RefreshButton, ToolbarActions, icons } from '../../../components/master/MasterKit';
import {
  ConfirmButton,
  DetailCard,
  DocStatusPill,
  DocTable,
  InfoGrid,
  PrimaryButton,
  SecondaryButton,
  fmtStamp,
  qty,
  type DocColumn,
} from '../../../components/wms/DocKit';
import GeneratePutawayModal, { type PutawayLine } from '../../../components/GeneratePutawayModal';
import { apiError, exportCsv, materialText } from '../transfer/transferInbound';

const BASE = '/admin/inbound/pib';

/**
 * Goods Receive Detail (PIB), as on WMS dev, with the shipment's Nomor Aju.
 * An Open GR is received in place: Confirm turns Actual Qty into inputs (with
 * Max), Confirm Receive submits the Item Receipt to Oracle. A received GR then
 * generates its putaways.
 */
const EXPORT_COLUMNS = ['No', 'PO Number', 'ERP PO ID', 'ERP Line ID', 'Material Code', 'Material Name', 'Supplier', 'UoM', 'Planned Qty', 'Actual Qty', 'Putaway Qty', 'Remain Qty'];
const exportRows = (items: PibGrItem[]) =>
  items.map((it, i) => [i + 1, it.po_number, it.erp_po_id, it.line_number, it.material_code, it.material_name, it.supplier, it.uom, it.planned_qty, it.actual_qty, it.putaway_qty, it.remain_qty]);

export default function PibGrDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [gr, setGr] = useState<PibGrDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Inline Receive.
  const [receiving, setReceiving] = useState(false);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Generate Putaway.
  const [putawayOpen, setPutawayOpen] = useState(false);
  const [putawayBins, setPutawayBins] = useState<BinOption[]>([]);
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [putawaySaving, setPutawaySaving] = useState(false);
  const [putawayError, setPutawayError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<PibGrDetail>(`/pib-inbound/goods-receive/${id}`);
      setGr(r.data);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Goods Receive not found.'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    setReceiving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !gr) return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  if (error || !gr) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }

  const canReceive = gr.can_receive && has('goods-receive:update');
  const toPutAway = gr.items.filter((it) => it.remain_qty > 0);
  const canGeneratePutaway = gr.status === 'OnProgress' && toPutAway.length > 0 && has('putaway:create');

  function startReceive() {
    setActuals(Object.fromEntries(gr!.items.map((it) => [it.id, it.actual_qty])));
    setReceiving(true);
  }

  async function confirmReceive() {
    const lines = gr!.items.map((it) => ({ id: it.id, qtyActual: Number(actuals[it.id]) || 0 }));
    for (const l of lines) {
      const it = gr!.items.find((x) => x.id === l.id)!;
      if (l.qtyActual < 0 || l.qtyActual > it.planned_qty + 1e-9) {
        toast.error(`Actual Qty for ${it.material_code ?? 'a material'} must be between 0 and ${it.planned_qty}.`);
        return;
      }
    }
    const total = lines.reduce((s, l) => s + l.qtyActual, 0);
    if (total <= 0) {
      toast.error('Enter the Actual Qty of at least one material.');
      return;
    }
    const ok = await confirm({
      title: 'Confirm Receive?',
      description: `${qty(total)} qty will be received and an Item Receipt is created in Oracle. This cannot be undone.`,
      type: 'warning',
      confirmText: 'Confirm',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.put(`/goods-receive/${gr!.id}/actuals`, { items: lines });
      const r = await api.post<{ gr_number: string }>(`/goods-receive/${gr!.id}/receive`);
      toast.success(`Received as ${r.data.gr_number}`);
      setReceiving(false);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Receive failed'));
    } finally {
      setSaving(false);
    }
  }

  async function openPutaway() {
    setPutawayError('');
    setPutawayOpen(true);
    setOptionsLoading(true);
    const params = { warehouseId: gr!.warehouse?.id ?? undefined };
    try {
      const [pu, bi] = await Promise.all([
        api.get<{ id: number; name: string }[]>('/users/pickers', { params }),
        api.get<BinOption[]>('/bins/options', { params }),
      ]);
      setPickers(pu.data);
      setPutawayBins(bi.data);
    } catch {
      setPickers([]);
      setPutawayBins([]);
    } finally {
      setOptionsLoading(false);
    }
  }

  async function generatePutaway(lines: PutawayLine[]) {
    setPutawayError('');
    setPutawaySaving(true);
    try {
      const r = await api.post<{ id: string; putaway_code: string }>('/putaway/generate', {
        items: lines.map((l) => ({ mrnItemId: l.itemId, plannedQty: l.plannedQty, binId: l.binId, pickerId: l.pickerId })),
      });
      setPutawayOpen(false);
      toast.success(`Putaway generated: ${r.data.putaway_code}`);
      navigate(`${BASE}/putaway/${r.data.id}`);
    } catch (err) {
      setPutawayError(apiError(err, 'Failed to generate putaway'));
    } finally {
      setPutawaySaving(false);
    }
  }

  function print() {
    printDoc({
      title: `Goods Receive — ${gr!.gr_number}`,
      subtitle: `${gr!.transaction_id ?? '-'} · ${gr!.warehouse?.name ?? '-'}`,
      meta: [
        { label: 'Status', value: gr!.status },
        { label: 'Transaction ID', value: gr!.transaction_id },
        { label: 'GR ID', value: gr!.gr_number },
        { label: 'ERP Doc ID', value: gr!.erp_doc_id },
        { label: 'Nomor Aju', value: gr!.aju_number },
        { label: 'Vessel Number', value: gr!.vessel_number },
        { label: 'Bill of Lading', value: gr!.bill_of_lading },
        { label: 'Ownership', value: gr!.ownership },
        { label: 'Warehouse', value: gr!.warehouse?.name },
        { label: 'Created At', value: fmtStamp(gr!.created_at) },
      ],
      tables: [
        {
          heading: 'Material List',
          columns: EXPORT_COLUMNS,
          rows: exportRows(gr!.items),
        },
      ],
    });
  }

  const columns: DocColumn<PibGrItem>[] = [
    { label: 'No', render: (_r, i) => i + 1 },
    { label: 'PO Number', render: (r) => r.po_number ?? '-' },
    { label: 'ERP PO ID', render: (r) => r.erp_po_id ?? '-' },
    { label: 'ERP Line ID', render: (r) => r.line_number ?? '-' },
    { label: 'Material Code', render: (r) => r.material_code ?? '-' },
    { label: 'Material Name', render: (r) => r.material_name ?? '-' },
    { label: 'Supplier', render: (r) => r.supplier ?? '-' },
    { label: 'Material Type', render: (r) => r.material_type ?? '-' },
    { label: 'Material Category', render: (r) => r.material_category ?? '-' },
    { label: 'UoM', render: (r) => r.uom ?? '-' },
    { label: 'Planned Qty', align: 'right', render: (r) => qty(r.planned_qty) },
    {
      label: 'Actual Qty',
      width: receiving ? 200 : undefined,
      render: (r) =>
        receiving ? (
          <div className="flex min-h-[42px] items-center gap-2">
            <input
              type="number"
              min={0}
              max={r.planned_qty}
              inputMode="decimal"
              className={`h-8 w-[120px] rounded-md border bg-white px-2 text-sm outline-none focus:border-blue-400 ${
                (actuals[r.id] ?? 0) > r.planned_qty ? 'border-red-400' : 'border-neutral-200'
              }`}
              value={actuals[r.id] ?? 0}
              onChange={(e) => setActuals((a) => ({ ...a, [r.id]: Number(e.target.value) }))}
            />
            <button
              type="button"
              className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              onClick={() => setActuals((a) => ({ ...a, [r.id]: r.planned_qty }))}
            >
              Max
            </button>
          </div>
        ) : (
          qty(r.actual_qty)
        ),
      align: receiving ? 'left' : 'right',
    },
    { label: 'Putaway Qty', align: 'right', render: (r) => qty(r.putaway_qty) },
    { label: 'Remain Qty', align: 'right', render: (r) => qty(r.remain_qty) },
    { label: 'Material Length', align: 'right', render: (r) => qty(r.material_length) },
    { label: 'Material Width', align: 'right', render: (r) => qty(r.material_width) },
    { label: 'Material Height', align: 'right', render: (r) => qty(r.material_height) },
    { label: 'Material Weight', align: 'right', render: (r) => qty(r.material_weight) },
  ];

  const menu = [
    { label: 'Print', icon: icons.printer, onClick: print },
    {
      label: 'Export',
      icon: icons.download,
      onClick: () =>
        exportCsv(`${gr.gr_number}.csv`, EXPORT_COLUMNS, exportRows(gr.items)),
    },
  ];

  // GR lines in the shape the Generate Putaway modal reads.
  const putawayItems: GoodsReceiveItem[] = toPutAway.map((it) => ({
    id: it.id,
    item_name: it.material_code,
    po_number: it.po_number,
    vendor_name: it.supplier,
    item_description: it.material_name,
    qty_expected: it.planned_qty,
    qty_actual: it.actual_qty,
    qty_remaining: it.remain_qty,
    bin_id: null,
    bin_label: null,
    receiving_location_name: gr.warehouse?.name ?? null,
    material_code: it.material_code,
    uom: it.uom,
  }));

  return (
    <>
      <DetailCard
        title="Goods Receive Detail"
        backTo={`${BASE}/goods-receive`}
        actions={
          receiving ? (
            <>
              <SecondaryButton onClick={() => setReceiving(false)} disabled={saving}>
                Cancel
              </SecondaryButton>
              <ConfirmButton onClick={confirmReceive} disabled={saving}>
                {saving ? 'Receiving…' : 'Confirm Receive'}
              </ConfirmButton>
            </>
          ) : (
            <>
              <ToolbarActions actions={menu} />
              <RefreshButton onClick={load} />
              {canReceive && <PrimaryButton onClick={startReceive}>Confirm</PrimaryButton>}
              {canGeneratePutaway && <PrimaryButton onClick={openPutaway}>Generate Putaway</PrimaryButton>}
            </>
          )
        }
      >
        <InfoGrid
          fields={[
            { label: 'Status', value: <DocStatusPill status={gr.status} /> },
            { label: 'Transaction ID', value: gr.transaction_id },
            { label: 'GR ID', value: gr.gr_number },
            { label: 'ERP Doc ID', value: gr.erp_doc_id },
            { label: 'Nomor Aju', value: gr.aju_number },
            { label: 'Expected Shipping Date', value: gr.expected_shipping_date },
            { label: 'Actual Shipping Date', value: gr.actual_shipping_date },
            { label: 'Expected Delivery Date', value: gr.expected_delivery_date },
            { label: 'Actual Delivery Date', value: gr.actual_delivery_date },
            { label: 'Vessel Number', value: gr.vessel_number },
            { label: 'Bill of Lading', value: gr.bill_of_lading },
            { label: 'Port', value: gr.port },
            { label: 'Ownership', value: gr.ownership },
            { label: 'Warehouse', value: gr.warehouse?.name },
            { label: 'Created By', value: gr.created_by },
            { label: 'Created At', value: fmtStamp(gr.created_at) },
            { label: 'Last Modified At', value: fmtStamp(gr.updated_at) },
          ]}
        />
        <div className="space-y-3">
          <div className="text-base font-semibold text-neutral-900 dark:text-white">Material List</div>
          <DocTable rows={gr.items} columns={columns} searchText={materialText} />
        </div>
      </DetailCard>

      <GeneratePutawayModal
        open={putawayOpen}
        grNumber={gr.gr_number}
        items={putawayItems}
        bins={putawayBins}
        pickers={pickers}
        loadingOptions={optionsLoading}
        submitting={putawaySaving}
        error={putawayError}
        onClose={() => setPutawayOpen(false)}
        onSubmit={generatePutaway}
      />
    </>
  );
}
