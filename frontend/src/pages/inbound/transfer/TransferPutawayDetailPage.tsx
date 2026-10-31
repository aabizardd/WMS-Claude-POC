import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../../lib/api';
import { printDoc } from '../../../lib/print';
import type { TransferPutawayDetail, TransferPutawayItem } from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../context/ConfirmContext';
import SearchableSelect from '../../../components/SearchableSelect';
import { RefreshButton, ToolbarActions, icons } from '../../../components/master/MasterKit';
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
} from '../../../components/wms/DocKit';
import { apiError, deleteTransferDoc, exportCsv, materialText } from './transferInbound';
import { TRANSFER_IN, type InboundSource } from './inboundSource';

interface Row {
  actual: number;
  quality: number;
  qtyIssue: number;
  pickerId: string;
}

/**
 * Putaway Detail (Transfer IN / Local Vendor), as on WMS dev. Putaway turns
 * the lines into – qty + steppers (Actual / Quality Issue / Quantity Issue)
 * and a Picker select; the Destination Bin was fixed when the putaway was
 * generated.
 * Confirm settles the putaway: whatever is left goes back to the GR.
 */
export default function TransferPutawayDetailPage({ source = TRANSFER_IN }: { source?: InboundSource } = {}) {
  const BASE = source.base;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [pt, setPt] = useState<TransferPutawayDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [pickerForAll, setPickerForAll] = useState('');
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<TransferPutawayDetail>(`${source.api}/putaway/${id}`);
      setPt(r.data);
      setError('');
      return r.data;
    } catch (err) {
      setError(apiError(err, 'Putaway not found.'));
      return null;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setEditing(false);
    load().then((d) => {
      if (!d) return;
      api
        .get<{ id: number; name: string }[]>('/users/pickers', { params: { warehouseId: d.warehouse?.id ?? undefined } })
        .then((r) => setPickers(r.data))
        .catch(() => setPickers([]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !pt) return <div className="card px-6 py-16 text-center text-slate-400">Loading…</div>;
  if (error || !pt) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }

  const canPutaway = pt.can_putaway && has('putaway:update');

  function start() {
    setRows(
      Object.fromEntries(
        pt!.items.map((it) => [
          it.id,
          { actual: 0, quality: 0, qtyIssue: 0, pickerId: it.picker ? String(it.picker.id) : '' },
        ]),
      ),
    );
    setPickerForAll('');
    setEditing(true);
  }
  function patch(itemId: string, p: Partial<Row>) {
    setRows((r) => ({ ...r, [itemId]: { ...r[itemId], ...p } }));
  }
  const handled = (r: Row) => r.actual + r.quality + r.qtyIssue;

  async function confirmPutaway() {
    for (const it of pt!.items) {
      const r = rows[it.id];
      if (handled(r) > it.planned_qty + 1e-9) {
        toast.error(`Actual + issues exceed the planned qty (${it.planned_qty}) for ${it.material_code ?? 'a material'}.`);
        return;
      }
    }
    const total = pt!.items.reduce((s, it) => s + handled(rows[it.id]), 0);
    if (total <= 0) {
      toast.error('Enter the Actual Qty (or an issue) of at least one material.');
      return;
    }
    const left = pt!.items.reduce((s, it) => s + it.planned_qty - handled(rows[it.id]), 0);
    const ok = await confirm({
      title: 'Confirm Putaway?',
      description:
        left > 0
          ? `${qty(left)} qty is not put away; it goes back to the Goods Receive to be put away on a new putaway. This putaway will be Closed.`
          : 'Every planned qty is handled and this putaway will be Closed.',
      type: left > 0 ? 'warning' : 'info',
      confirmText: 'Confirm',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const pickersChanged = pt!.items.some((it) => (it.picker ? String(it.picker.id) : '') !== rows[it.id].pickerId);
      if (pickersChanged) {
        await api.put(`/putaway/${pt!.id}/assign`, {
          items: pt!.items.map((it) => ({ id: it.id, pickerId: rows[it.id].pickerId ? Number(rows[it.id].pickerId) : null })),
        });
      }
      await api.put(`/putaway/${pt!.id}/confirm`, {
        items: pt!.items.map((it) => ({
          id: it.id,
          actualQty: rows[it.id].actual,
          qualityIssue: rows[it.id].quality,
          qtyIssue: rows[it.id].qtyIssue,
          binId: it.bin?.id ?? null,
        })),
      });
      toast.success(`Putaway ${pt!.putaway_code} confirmed`);
      setEditing(false);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Putaway failed'));
    } finally {
      setSaving(false);
    }
  }

  const pickerOptions = pickers.map((p) => ({ value: String(p.id), label: p.name }));
  const stepperCell = (key: 'actual' | 'quality' | 'qtyIssue', fallback: (r: TransferPutawayItem) => number) =>
    (r: TransferPutawayItem) => {
      if (!editing) return qty(fallback(r));
      const row = rows[r.id];
      const others = handled(row) - row[key];
      return (
        <Stepper
          value={row[key]}
          max={Math.max(0, r.planned_qty - others)}
          invalid={handled(row) > r.planned_qty + 1e-9}
          onChange={(v) => patch(r.id, { [key]: v })}
        />
      );
    };

  const columns: DocColumn<TransferPutawayItem>[] = [
    { label: 'No', render: (_r, i) => i + 1 },
    { label: 'ERP Line ID', render: (r) => r.line_number ?? '-' },
    { label: 'Material Code', render: (r) => r.material_code ?? '-' },
    { label: 'Material Name', render: (r) => r.material_name ?? '-' },
    { label: 'Material Type', render: (r) => r.material_type ?? '-' },
    { label: 'Material Category', render: (r) => r.material_category ?? '-' },
    { label: 'UoM', render: (r) => r.uom ?? '-' },
    { label: 'Planned Qty', align: 'right', render: (r) => qty(r.planned_qty) },
    { label: 'Actual Qty', align: editing ? 'center' : 'right', render: stepperCell('actual', (r) => r.actual_qty) },
    { label: 'Quality Issue', align: editing ? 'center' : 'right', render: stepperCell('quality', (r) => r.quality_issue) },
    { label: 'Quantity Issue', align: editing ? 'center' : 'right', render: stepperCell('qtyIssue', (r) => r.qty_issue) },
    {
      label: 'Remaining Qty',
      align: 'right',
      render: (r) => qty(editing ? r.planned_qty - handled(rows[r.id]) : r.remaining_qty),
    },
    {
      label: 'Picker',
      width: editing ? 200 : undefined,
      render: (r) =>
        editing ? (
          <SearchableSelect
            className="w-48"
            value={rows[r.id].pickerId}
            onChange={(v) => patch(r.id, { pickerId: v })}
            placeholder="Select Picker..."
            searchPlaceholder="Search picker…"
            options={pickerOptions}
          />
        ) : (
          r.picker?.name ?? '-'
        ),
    },
    { label: 'Destination Bin', render: (r) => r.bin?.label ?? '-' },
    { label: 'Material Length', align: 'right', render: (r) => qty(r.material_length) },
    { label: 'Material Width', align: 'right', render: (r) => qty(r.material_width) },
    { label: 'Material Height', align: 'right', render: (r) => qty(r.material_height) },
    { label: 'Material Weight', align: 'right', render: (r) => qty(r.material_weight) },
  ];

  // In Putaway mode the table's first row sets one picker for every line.
  const pickerAllRow = editing ? (
    <tr className="bg-[#F5F6FD] dark:bg-[#5166AE]/10">
      <td colSpan={12} className="border-b border-[#E1E4F8] px-6 py-3 text-sm dark:border-[#5166AE]/30">
        <span className="font-semibold text-[#3F4F8C] dark:text-[#c7cff0]">Picker for all items</span>
        <span className="ml-2 text-xs text-neutral-500">Pick one here to assign it to every material — any row can still be changed.</span>
      </td>
      <td className="border-b border-[#E1E4F8] px-2.5 py-3 dark:border-[#5166AE]/30">
        <SearchableSelect
          className="w-48"
          value={pickerForAll}
          onChange={(v) => {
            setPickerForAll(v);
            setRows((r) => Object.fromEntries(Object.entries(r).map(([k, row]) => [k, { ...row, pickerId: v }])));
          }}
          placeholder="Assign to all…"
          searchPlaceholder="Search picker…"
          options={pickerOptions}
        />
      </td>
      <td colSpan={5} className="border-b border-[#E1E4F8] dark:border-[#5166AE]/30" />
    </tr>
  ) : undefined;

  const listColumns = ['No', 'Material Code', 'Material Name', 'UoM', 'Planned Qty', 'Actual Qty', 'Quality Issue', 'Quantity Issue', 'Remaining Qty', 'Picker', 'Destination Bin'];
  const listRows = pt.items.map((it, i) => [
    i + 1, it.material_code, it.material_name, it.uom, it.planned_qty, it.actual_qty, it.quality_issue, it.qty_issue, it.remaining_qty, it.picker?.name, it.bin?.label,
  ]);
  const menu = [
    {
      label: 'Print',
      icon: icons.printer,
      onClick: () =>
        printDoc({
          title: `Putaway — ${pt.putaway_code}`,
          subtitle: `${pt.transaction_id ?? '-'} · ${pt.gr_number ?? '-'}`,
          meta: [
            { label: 'Status', value: pt.status },
            { label: 'Transaction ID', value: pt.transaction_id },
            { label: 'Putaway Code', value: pt.putaway_code },
            { label: 'GR ID', value: pt.gr_number },
            { label: 'Warehouse', value: pt.warehouse?.name },
            { label: 'Ownership', value: pt.ownership },
            { label: 'Created At', value: fmtStamp(pt.created_at) },
          ],
          tables: [{ heading: 'Material List', columns: listColumns, rows: listRows }],
        }),
    },
    { label: 'Export', icon: icons.download, onClick: () => exportCsv(`${pt.putaway_code}.csv`, listColumns, listRows) },
    ...(pt.can_delete && has('putaway:delete')
      ? [
          {
            label: 'Delete',
            icon: icons.trash,
            onClick: async () => {
              if (await deleteTransferDoc('putaway', pt.id, pt.putaway_code, confirm, toast, source))
                navigate(`${BASE}/putaway`);
            },
          },
        ]
      : []),
  ];

  return (
    <DetailCard
      title="Putaway Detail"
      backTo={`${BASE}/putaway`}
      actions={
        editing ? (
          <>
            <SecondaryButton onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </SecondaryButton>
            <ConfirmButton onClick={confirmPutaway} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </ConfirmButton>
          </>
        ) : (
          <>
            <ToolbarActions actions={menu} />
            <RefreshButton onClick={load} />
            {canPutaway && <PrimaryButton onClick={start}>Putaway</PrimaryButton>}
          </>
        )
      }
    >
      <InfoGrid
        fields={[
          { label: 'Status', value: <DocStatusPill status={pt.status} /> },
          { label: 'Transaction ID', value: pt.transaction_id },
          { label: 'Putaway Code', value: pt.putaway_code },
          {
            label: 'GR ID',
            value: pt.gr_id ? (
              <button type="button" className="text-[#5166AE] hover:underline" onClick={() => navigate(`${BASE}/goods-receive/${pt.gr_id}`)}>
                {pt.gr_number}
              </button>
            ) : (
              pt.gr_number
            ),
          },
          { label: 'Warehouse Name', value: pt.warehouse?.name },
          { label: 'Ownership', value: pt.ownership },
          { label: 'Created At', value: fmtStamp(pt.created_at) },
          { label: 'Last Modified At', value: fmtStamp(pt.updated_at) },
        ]}
      />
      <div className="space-y-3">
        <div className="text-base font-semibold text-neutral-900 dark:text-white">Material List</div>
        <DocTable rows={pt.items} columns={columns} searchText={materialText} topRow={pickerAllRow} />
      </div>
    </DetailCard>
  );
}
