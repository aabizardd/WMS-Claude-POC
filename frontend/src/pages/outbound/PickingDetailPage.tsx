import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api';
import { printDoc } from '../../lib/print';
import type { PickingDetail, PickingItemRow } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { RefreshButton, ToolbarActions, icons } from '../../components/master/MasterKit';
import {
  ConfirmButton,
  DetailCard,
  DocStatusPill,
  DocTable,
  InfoGrid,
  PrimaryButton,
  SecondaryButton,
  Stepper,
  fmtStamp,
  qty,
  type DocColumn,
} from '../../components/wms/DocKit';
import { apiError, exportCsv, materialText } from '../inbound/transfer/transferInbound';
import { lineStatus } from './outboundLines';
import { progressConfirm } from './progressConfirm';

interface RowInput {
  actual: number;
  qtyIssue: number;
  quality: number;
}

const handled = (r: RowInput) => r.actual + r.qtyIssue + r.quality;

/**
 * Picking List Detail, as on WMS dev. Ticking lines brings up "Pick": the
 * ticked lines turn into steppers (Actual / Quality Issue / Quantity Issue)
 * and Confirm records that progress. The picking closes once every line is
 * done.
 */
export default function PickingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [pk, setPk] = useState<PickingDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [inputs, setInputs] = useState<Record<string, RowInput>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<PickingDetail>(`/picking/${id}`);
      setPk(r.data);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Picking not found.'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setPicking(false);
    setTicked(new Set());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !pk) return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  if (error || !pk) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }

  const isTransfer = pk.source_type === 'TRANSFER_ORDER';
  const base = isTransfer ? '/admin/outbound/transfer-stock' : '/admin/outbound/sales-order';
  const editable = has('picking:update') && pk.status !== 'Closed';
  const canTick = (it: PickingItemRow) => editable && it.remaining_qty > 1e-9;
  const tickable = pk.items.filter(canTick);
  const allTicked = tickable.length > 0 && tickable.every((it) => ticked.has(it.id));
  const chosen = pk.items.filter((it) => ticked.has(it.id));

  function toggle(itemId: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  /** Pick: what is left to pick starts as Actual, the issues at 0. */
  function startPick() {
    setInputs(Object.fromEntries(chosen.map((it) => [it.id, { actual: it.remaining_qty, qtyIssue: 0, quality: 0 }])));
    setPicking(true);
  }

  async function confirmPick() {
    for (const it of chosen) {
      if (handled(inputs[it.id]) > it.remaining_qty + 1e-9) {
        toast.error(`Actual + issues exceed the remaining qty (${it.remaining_qty}) for ${it.material_code ?? 'a material'}.`);
        return;
      }
    }
    const items = chosen
      .map((it) => ({
        id: it.id,
        actualQty: inputs[it.id].actual,
        qtyIssue: inputs[it.id].qtyIssue,
        qualityIssue: inputs[it.id].quality,
      }))
      .filter((x) => x.actualQty + x.qtyIssue + x.qualityIssue > 0);
    if (!items.length) {
      toast.error('Enter the Actual Qty (or an issue) of at least one material.');
      return;
    }
    const ok = await confirm(
      progressConfirm(
        'picking',
        pk!.items
          .filter((it) => it.remaining_qty > 0)
          .map((it) => {
            const f = inputs[it.id] ?? { actual: 0, qtyIssue: 0, quality: 0 };
            return { remaining: it.remaining_qty, actual: f.actual, qtyIssue: f.qtyIssue, quality: f.quality };
          }),
      ),
    );
    if (!ok) return;
    setSaving(true);
    try {
      await api.put(`/picking/${pk!.id}/progress`, { items });
      toast.success(`Picking ${pk!.picking_id} updated`);
      setPicking(false);
      setTicked(new Set());
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Pick failed'));
    } finally {
      setSaving(false);
    }
  }

  const stepper = (key: keyof RowInput, fallback: (r: PickingItemRow) => number) => (r: PickingItemRow) => {
    const row = inputs[r.id];
    if (!picking || !row) return qty(fallback(r));
    const others = handled(row) - row[key];
    return (
      <Stepper
        value={row[key]}
        max={Math.max(0, r.remaining_qty - others)}
        invalid={handled(row) > r.remaining_qty + 1e-9}
        onChange={(v) => setInputs((s) => ({ ...s, [r.id]: { ...s[r.id], [key]: v } }))}
      />
    );
  };

  const columns: DocColumn<PickingItemRow>[] = [
    ...(editable && !picking
      ? [
          {
            label: 'Select',
            header: (
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                checked={allTicked}
                disabled={tickable.length === 0}
                onChange={() => setTicked(allTicked ? new Set() : new Set(tickable.map((it) => it.id)))}
                aria-label="Select every line left to pick"
              />
            ),
            render: (r: PickingItemRow) => (
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                checked={ticked.has(r.id)}
                disabled={!canTick(r)}
                onChange={() => toggle(r.id)}
                aria-label={`Select ${r.material_code ?? 'line'}`}
              />
            ),
          },
        ]
      : []),
    { label: 'No', render: (_r, i) => i + 1 },
    { label: 'Status', render: (r) => <DocStatusPill status={lineStatus(r)} /> },
    { label: 'Warehouse Name', render: () => pk.location ?? '-' },
    { label: 'Material Code', render: (r) => r.material_code ?? '-' },
    { label: 'Material Name', render: (r) => r.material_name ?? '-' },
    { label: 'Material Type', render: (r) => r.material_type ?? '-' },
    { label: 'Material Category', render: (r) => r.material_category ?? '-' },
    { label: 'Available Qty', align: 'right', render: (r) => qty(r.bin_available_qty) },
    { label: 'UOM', render: (r) => r.uom ?? '-' },
    { label: 'Supplier', render: () => '-' },
    { label: 'Planned Qty', align: 'right', render: (r) => qty(r.request_qty) },
    { label: 'Actual Qty', align: picking ? 'center' : 'right', render: stepper('actual', (r) => r.actual_qty) },
    { label: 'Quality Issue', align: picking ? 'center' : 'right', render: stepper('quality', (r) => r.quality_issue) },
    { label: 'Quantity Issue', align: picking ? 'center' : 'right', render: stepper('qtyIssue', (r) => r.qty_issue) },
    {
      label: 'Remaining Qty',
      align: 'right',
      render: (r) => qty(picking && inputs[r.id] ? r.remaining_qty - handled(inputs[r.id]) : r.remaining_qty),
    },
    { label: 'Picking Progress', render: (r) => `${qty(r.progress.done)}/${qty(r.progress.total)}` },
    { label: 'Bin Label', render: (r) => r.bin_label ?? '-' },
    { label: 'Shelf Label', render: (r) => r.shelf_label ?? '-' },
    { label: 'Aisle Name', render: (r) => r.aisle_name ?? '-' },
    { label: 'Picker', render: (r) => r.picker?.name ?? '-' },
    { label: 'Last Modified By', render: (r) => r.updated_by ?? '-' },
    { label: 'Last Modified At', render: (r) => (r.updated_at ? fmtStamp(r.updated_at) : '-') },
  ];

  const listColumns = ['No', 'Material Code', 'Material Name', 'UoM', 'Bin Label', 'Planned Qty', 'Actual Qty', 'Quality Issue', 'Quantity Issue', 'Remaining Qty', 'Picker'];
  const listRows = pk.items.map((it, i) => [
    i + 1, it.material_code, it.material_name, it.uom, it.bin_label, it.request_qty, it.actual_qty, it.quality_issue, it.qty_issue, it.remaining_qty, it.picker?.name,
  ]);
  const meta = [
    { label: 'Status', value: pk.status },
    { label: 'Transaction ID', value: pk.source_number },
    { label: isTransfer ? 'TO ID' : 'SO ID', value: pk.outbound_id },
    { label: 'Picking ID', value: pk.picking_id },
    { label: 'Warehouse', value: pk.location },
    { label: isTransfer ? 'Destination Warehouse' : 'Customer Name', value: pk.customer },
    { label: 'Created At', value: fmtStamp(pk.created_at) },
  ];
  const menu = [
    {
      label: 'Print',
      icon: icons.printer,
      onClick: () =>
        printDoc({
          title: `Picking List — ${pk.picking_id}`,
          subtitle: `${pk.source_number ?? '-'} · ${pk.location ?? '-'}`,
          meta,
          tables: [{ heading: 'Material List', columns: listColumns, rows: listRows }],
        }),
    },
    { label: 'Export', icon: icons.download, onClick: () => exportCsv(`${pk.picking_id}.csv`, listColumns, listRows) },
  ];

  return (
    <DetailCard
      title="Picking List Detail"
      backTo={`${base}/picking`}
      actions={
        picking ? (
          <>
            <SecondaryButton onClick={() => setPicking(false)} disabled={saving}>
              Cancel
            </SecondaryButton>
            <ConfirmButton onClick={confirmPick} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </ConfirmButton>
          </>
        ) : (
          <>
            <ToolbarActions actions={menu} />
            <RefreshButton onClick={load} />
            {chosen.length > 0 && <PrimaryButton onClick={startPick}>Pick</PrimaryButton>}
          </>
        )
      }
    >
      <InfoGrid
        fields={[
          { label: 'Status', value: <DocStatusPill status={pk.status} /> },
          { label: 'Transaction ID', value: pk.source_number },
          { label: isTransfer ? 'TO ID' : 'SO ID', value: pk.outbound_id },
          { label: 'Picking ID', value: pk.picking_id },
          { label: 'Doc Type', value: 'Picking List' },
          { label: 'Ownership', value: pk.ownership },
          { label: 'Origin Warehouse', value: pk.location },
          { label: 'Destination Warehouse', value: isTransfer ? pk.destination : null },
          { label: 'Customer Name', value: isTransfer ? null : pk.customer },
          { label: 'Created By', value: pk.created_by },
          { label: 'Created At', value: fmtStamp(pk.created_at) },
          { label: 'Last Modified By', value: pk.updated_by },
          { label: 'Last Modified At', value: pk.updated_by ? fmtStamp(pk.updated_at) : null },
        ]}
      />
      <DocTable
        rows={picking ? chosen : pk.items}
        columns={columns}
        searchText={materialText}
        searchPlaceholder="Search..."
        rowClass={(r) => (ticked.has(r.id) && !picking ? 'bg-brand-50/50' : '')}
      />
    </DetailCard>
  );
}
