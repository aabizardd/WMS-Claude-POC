import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  SalesDeliveryFormOptions,
  SdBinOption,
  SdMaterialOption,
} from '../../types';
import { useToast } from '../../context/ToastContext';
import { useWarehouse } from '../../context/WarehouseContext';
import SearchableSelect from '../../components/SearchableSelect';
import Modal from '../../components/Modal';

interface BinLine {
  key: string;
  bin_id: string;
  bin_label: string | null;
  avail: number;
  qty_transfer: number;
}

interface Group {
  material_id: string;
  material_code: string | null;
  material_name: string | null;
  uom_code: string | null;
  allows_decimal: boolean;
  binOptions: SdBinOption[];
  binsLoaded: boolean;
  lines: BinLine[];
}

let seq = 0;
const nextKey = () => `l-${seq++}`;
const EPS = 1e-9;

export default function SalesDeliveryCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWarehouseId } = useWarehouse();

  const [options, setOptions] = useState<SalesDeliveryFormOptions | null>(null);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [classId, setClassId] = useState('');
  const [memo, setMemo] = useState('');

  const [materials, setMaterials] = useState<SdMaterialOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Header options. Re-read when the active warehouse changes, since From
  // Location defaults to it.
  useEffect(() => {
    api
      .get<SalesDeliveryFormOptions>('/sales-delivery/form-options')
      .then((r) => {
        setOptions(r.data);
        setFromWarehouseId(r.data.default_from_warehouse_id ?? '');
        setToWarehouseId((prev) =>
          prev === r.data.default_from_warehouse_id ? '' : prev,
        );
        // Department defaults to the creator's own, still overridable.
        setDepartmentId((prev) => prev || r.data.default_department_id || '');
      })
      .catch(() => setOptions(null));
  }, [activeWarehouseId]);

  // Materials and bins belong to the From warehouse: a new From clears every line.
  useEffect(() => {
    setGroups([]);
    if (!fromWarehouseId) {
      setMaterials([]);
      return;
    }
    let active = true;
    api
      .get<SdMaterialOption[]>('/sales-delivery/materials', {
        params: { from_warehouse_id: fromWarehouseId },
      })
      .then((r) => active && setMaterials(r.data))
      .catch(() => active && setMaterials([]));
    // Ignore a slower response for a From that was already replaced.
    return () => {
      active = false;
    };
  }, [fromWarehouseId]);

  function changeFrom(id: string) {
    if (id === fromWarehouseId) return;
    if (groups.length > 0) {
      const ok = window.confirm(
        'Changing From Location clears every material, bin and qty already entered. Continue?',
      );
      if (!ok) return;
    }
    setFromWarehouseId(id);
  }

  // One warehouse list for both sides; each hides what the other has picked.
  const warehouseOptions = options?.warehouse_options ?? [];
  const fromOptions = warehouseOptions
    .filter((w) => w.id !== toWarehouseId)
    .map((w) => ({ value: w.id, label: w.name }));
  const toOptions = warehouseOptions
    .filter((w) => w.id !== fromWarehouseId)
    .map((w) => ({ value: w.id, label: w.name }));

  const usedMaterialIds = new Set(groups.map((g) => g.material_id));
  const materialOptions = materials
    .filter((m) => m.material_id && !usedMaterialIds.has(m.material_id))
    .map((m) => ({
      value: m.material_id as string,
      label: m.material_name
        ? `${m.material_code} — ${m.material_name}`
        : m.material_code ?? (m.material_id as string),
    }));

  async function addMaterial(materialId: string) {
    const m = materials.find((x) => x.material_id === materialId);
    if (!m || !m.material_id) return;
    setGroups((gs) => [
      ...gs,
      {
        material_id: m.material_id as string,
        material_code: m.material_code,
        material_name: m.material_name,
        uom_code: m.uom_code ?? null,
        allows_decimal: m.allows_decimal ?? true,
        binOptions: [],
        binsLoaded: false,
        lines: [],
      },
    ]);
    try {
      const r = await api.get<SdBinOption[]>('/sales-delivery/bins', {
        params: { material_id: m.material_id, from_warehouse_id: fromWarehouseId },
      });
      setGroups((gs) =>
        gs.map((g) =>
          g.material_id === materialId
            ? { ...g, binOptions: r.data, binsLoaded: true }
            : g,
        ),
      );
    } catch {
      setGroups((gs) =>
        gs.map((g) => (g.material_id === materialId ? { ...g, binsLoaded: true } : g)),
      );
    }
  }

  function removeMaterial(materialId: string) {
    setGroups((gs) => gs.filter((g) => g.material_id !== materialId));
  }

  function addBin(materialId: string, binId: string) {
    setGroups((gs) =>
      gs.map((g) => {
        if (g.material_id !== materialId) return g;
        const opt = g.binOptions.find((b) => b.bin_id === binId);
        if (!opt || !opt.bin_id) return g;
        // The same bin can only appear once per material.
        if (g.lines.some((l) => l.bin_id === binId)) return g;
        return {
          ...g,
          lines: [
            ...g.lines,
            {
              key: nextKey(),
              bin_id: opt.bin_id,
              bin_label: opt.bin_label,
              avail: opt.qty_available,
              qty_transfer: 0,
            },
          ],
        };
      }),
    );
  }

  /** Removing the last bin of a material removes the material row too. */
  function removeBin(materialId: string, key: string) {
    setGroups((gs) =>
      gs
        .map((g) =>
          g.material_id === materialId
            ? { ...g, lines: g.lines.filter((l) => l.key !== key) }
            : g,
        )
        .filter((g) => g.material_id !== materialId || g.lines.length > 0),
    );
  }

  function patchLine(materialId: string, key: string, patch: Partial<BinLine>) {
    setGroups((gs) =>
      gs.map((g) =>
        g.material_id === materialId
          ? { ...g, lines: g.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }
          : g,
      ),
    );
  }

  // One error message per line, so the user sees exactly which row is wrong.
  const lineErrors = useMemo(() => {
    const errs = new Map<string, string>();
    for (const g of groups) {
      for (const l of g.lines) {
        const qty = Number(l.qty_transfer) || 0;
        if (qty < 0) {
          errs.set(l.key, 'Qty Transfer cannot be negative');
        } else if (qty <= EPS) {
          errs.set(l.key, 'Enter a Qty Transfer greater than 0');
        } else if (qty > l.avail + EPS) {
          errs.set(l.key, `Exceeds the available qty (${l.avail})`);
        } else if (!g.allows_decimal && Math.abs(qty - Math.round(qty)) > EPS) {
          errs.set(l.key, 'This unit of measure does not allow decimals');
        }
      }
    }
    return errs;
  }, [groups]);

  const allLines = groups.flatMap((g) => g.lines);
  const emptyGroups = groups.filter((g) => g.lines.length === 0);
  const totalQty = allLines.reduce((s, l) => s + (Number(l.qty_transfer) || 0), 0);

  const blockingMessage = (() => {
    if (!fromWarehouseId) return 'Select a From Location.';
    if (!toWarehouseId) return 'Select a To Location.';
    if (!departmentId) return 'Select a department.';
    if (!classId) return 'Select a class.';
    if (allLines.length === 0) return 'Add at least one material and bin.';
    if (emptyGroups.length > 0) return 'Every material needs at least one bin.';
    if (lineErrors.size > 0) return 'Fix the highlighted lines before submitting.';
    return '';
  })();
  const canSave = !blockingMessage;

  const fromWarehouseName =
    warehouseOptions.find((w) => w.id === fromWarehouseId)?.name ?? '—';
  const toWarehouseName =
    warehouseOptions.find((w) => w.id === toWarehouseId)?.name ?? '—';
  const departmentName = (() => {
    const d = options?.department_options.find((x) => x.id === departmentId);
    return d ? d.name ?? d.oracle_id : '—';
  })();
  // What the memo will look like once stored: "{memo} | {SD number}". The number
  // only exists after the document is created, so it is shown as a placeholder.
  const memoPreview = memo.trim() ? `${memo.trim()} | SD-…` : 'SD-…';

  const className = (() => {
    const c = options?.class_options.find((x) => x.id === classId);
    return c ? c.name ?? c.oracle_id : '—';
  })();

  async function handleSubmit() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const r = await api.post<{ id: string; delivery_number: string }>(
        '/sales-delivery',
        {
          from_warehouse_id: fromWarehouseId,
          to_warehouse_id: toWarehouseId,
          department_id: departmentId,
          class_id: classId,
          memo: memo.trim() || undefined,
          items: groups.flatMap((g) =>
            g.lines.map((l) => ({
              material_id: g.material_id,
              bin_id: l.bin_id,
              qty_transfer: Number(l.qty_transfer) || 0,
            })),
          ),
        },
      );
      toast.success(`${r.data.delivery_number} submitted`);
      navigate(`/admin/inventory/sales-delivery/${r.data.id}`);
    } catch (err) {
      // Keep the dialog open so the user can see the error and retry.
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        toast.error(
          Array.isArray(m) ? m.join(', ') : (m ?? 'Could not submit the delivery'),
        );
      } else {
        toast.error('Could not submit the delivery');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/admin/inventory/sales-delivery"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            Create Inventory Sales Delivery
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock transfer between two locations. Submitting records the document — it
            does not move stock yet.
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Header
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-slate-400">From Location *</div>
            <SearchableSelect
              value={fromWarehouseId}
              onChange={changeFrom}
              placeholder="Select location…"
              searchPlaceholder="Search location…"
              disabled={!options}
              options={fromOptions}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">To Location *</div>
            <SearchableSelect
              value={toWarehouseId}
              onChange={setToWarehouseId}
              placeholder="Select location…"
              searchPlaceholder="Search location…"
              disabled={!options}
              options={toOptions}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">Department *</div>
            <SearchableSelect
              value={departmentId}
              onChange={setDepartmentId}
              placeholder="Select department…"
              searchPlaceholder="Search department…"
              disabled={!options}
              options={(options?.department_options ?? []).map((d) => ({
                value: d.id,
                label: d.name ? `${d.name} (${d.oracle_id})` : d.oracle_id,
              }))}
            />
            {options?.default_department_id && (
              <p className="mt-1 text-xs text-slate-400">
                Defaults to your own department — change it if this transfer belongs to
                another one.
              </p>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">Class *</div>
            <SearchableSelect
              value={classId}
              onChange={setClassId}
              placeholder="Select class…"
              searchPlaceholder="Search class…"
              disabled={!options}
              options={(options?.class_options ?? []).map((c) => ({
                value: c.id,
                label: c.name ? `${c.name} (${c.oracle_id})` : c.oracle_id,
              }))}
            />
          </div>
          <div className="lg:col-span-4">
            <div className="mb-1 text-xs text-slate-400">Memo (optional)</div>
            <input
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Reason or context for this transfer…"
            />
            <p className="mt-1 text-xs text-slate-400">
              Stored as{' '}
              <span className="font-mono text-slate-500">{memoPreview}</span> — the
              delivery number is appended automatically on submit.
            </p>
          </div>
        </div>
      </div>

      {/* Materials + bins */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Materials &amp; Bins
          </h3>
          <div className="w-72">
            <SearchableSelect
              value=""
              onChange={addMaterial}
              options={materialOptions}
              placeholder={fromWarehouseId ? '+ Add material…' : 'Choose a From Location first'}
              searchPlaceholder="Search material…"
              disabled={!fromWarehouseId}
            />
          </div>
        </div>

        {!fromWarehouseId ? (
          <p className="text-sm text-slate-400">
            Select a From Location to enable material selection.
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-400">
            {materials.length === 0
              ? 'No material with available stock in this location.'
              : 'No material added yet. Choose a material to begin.'}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const binOpts = g.binOptions
                .filter((b) => b.bin_id && !g.lines.some((l) => l.bin_id === b.bin_id))
                .map((b) => ({
                  value: b.bin_id as string,
                  label: b.bin_label ?? (b.bin_id as string),
                }));
              return (
                <div key={g.material_id} className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                    <div>
                      <div className="font-medium text-slate-800">
                        {g.material_code}
                        {g.material_name ? (
                          <span className="ml-2 text-xs text-slate-400">{g.material_name}</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {g.uom_code ? `UoM ${g.uom_code}` : 'No UoM'}
                        {!g.allows_decimal && ' · whole numbers only'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-52">
                        <SearchableSelect
                          value=""
                          onChange={(v) => addBin(g.material_id, v)}
                          options={binOpts}
                          placeholder={
                            !g.binsLoaded
                              ? 'Loading bins…'
                              : binOpts.length === 0
                                ? 'No bin left'
                                : '+ Add bin…'
                          }
                          searchPlaceholder="Search bin…"
                          disabled={!g.binsLoaded || binOpts.length === 0}
                        />
                      </div>
                      <button
                        className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        onClick={() => removeMaterial(g.material_id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {g.lines.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-400">
                      Choose a bin for this material.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-100 text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="px-4 py-2">Bin</th>
                            <th className="px-4 py-2 text-right">Available</th>
                            <th className="px-4 py-2 text-right">Qty Transfer</th>
                            <th className="px-4 py-2 text-right">Remaining</th>
                            <th className="px-4 py-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {g.lines.map((l) => {
                            const err = lineErrors.get(l.key);
                            const remaining = l.avail - (Number(l.qty_transfer) || 0);
                            return (
                              <tr key={l.key} className={err ? 'bg-rose-50/50' : undefined}>
                                <td className="px-4 py-2 font-medium text-slate-800">
                                  {l.bin_label ?? l.bin_id}
                                  {err && (
                                    <div className="mt-0.5 text-xs font-normal text-rose-600">
                                      {err}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-600">{l.avail}</td>
                                <td className="px-4 py-2">
                                  <div className="flex justify-end">
                                    <input
                                      type="number"
                                      step={g.allows_decimal ? 'any' : '1'}
                                      min={0}
                                      max={l.avail}
                                      className="input w-28 text-right"
                                      value={l.qty_transfer}
                                      onChange={(e) =>
                                        patchLine(g.material_id, l.key, {
                                          qty_transfer: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-right text-xs text-slate-500">
                                  <b className={remaining < 0 ? 'text-rose-600' : 'text-brand-700'}>
                                    {remaining}
                                  </b>
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex justify-end">
                                    <button
                                      className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                                      onClick={() => removeBin(g.material_id, l.key)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
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
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {blockingMessage && <span className="text-xs text-amber-600">{blockingMessage}</span>}
        <Link to="/admin/inventory/sales-delivery" className="btn-secondary">
          Cancel
        </Link>
        <button className="btn-primary" onClick={() => setConfirming(true)} disabled={!canSave}>
          Submit
        </button>
      </div>

      {/* Preview of everything entered — the confirmation IS the submission. */}
      <Modal
        open={confirming}
        title="Submit this sales delivery?"
        onClose={() => (saving ? null : setConfirming(false))}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Row label="From Location" value={fromWarehouseName} />
            <Row label="To Location" value={toWarehouseName} />
            <Row label="Department" value={departmentName} />
            <Row label="Class" value={className} />
            <Row label="Materials" value={groups.length} />
            <Row label="Bin lines" value={allLines.length} />
            <Row label="Total Qty Transfer" value={totalQty} />
            <Row
              label="Memo (as stored)"
              value={<span className="font-mono text-xs">{memoPreview}</span>}
            />
          </dl>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Bin</th>
                  <th className="px-3 py-2 text-right">Available</th>
                  <th className="px-3 py-2 text-right">Qty Transfer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.flatMap((g) =>
                  g.lines.map((l) => (
                    <tr key={l.key}>
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {g.material_code}
                        {g.material_name ? (
                          <span className="ml-1 font-normal text-slate-400">
                            {g.material_name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{l.bin_label ?? l.bin_id}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{l.avail}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {l.qty_transfer}
                        {g.uom_code ? (
                          <span className="ml-1 font-normal text-slate-400">{g.uom_code}</span>
                        ) : null}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Once confirmed the document is recorded and <b>can no longer be edited or
            deleted</b>. A correction requires a new document. Stock in the bins above is{' '}
            <b>not changed</b> by this submission.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              className="btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={saving}
            >
              Back to edit
            </button>
            <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Submitting…' : 'Confirm & Submit'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  );
}
