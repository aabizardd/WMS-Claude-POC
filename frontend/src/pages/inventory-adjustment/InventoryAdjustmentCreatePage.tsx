import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  AdjBinOption,
  AdjDiscrepancyOption,
  AdjMaterialOption,
  IaType,
  IaTypeInfo,
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
  qty_issue: number;
  quality_issue: number;
  /** Auto-filled and read-only for the Discrepancy types. */
  qty_adjustment: number;
  qty_passed: number;
  qty_non_passed: number;
}

interface Group {
  material_id: string;
  material_code: string | null;
  material_name: string | null;
  allows_decimal: boolean;
  binOptions: AdjBinOption[];
  binsLoaded: boolean;
  lines: BinLine[];
}

let seq = 0;
const nextKey = () => `l-${seq++}`;
const EPS = 1e-9;

export default function InventoryAdjustmentCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWarehouseId, activeWarehouseName, canSwitch } = useWarehouse();

  const [types, setTypes] = useState<IaTypeInfo[]>([]);
  const [type, setType] = useState<IaType | ''>('');
  const [memo, setMemo] = useState('');
  const [classes, setClasses] = useState<{ id: string; name: string | null; oracleId: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [materials, setMaterials] = useState<AdjMaterialOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AdjDiscrepancyOption[]>([]);
  const [selectedDiscs, setSelectedDiscs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Admin with "All sites" selected cannot create — needs a concrete warehouse.
  const noWarehouse = canSwitch && !activeWarehouseId;
  const rule = useMemo(() => types.find((t) => t.value === type) ?? null, [types, type]);

  // The behaviour matrix comes from the server so the UI cannot drift from it.
  useEffect(() => {
    api
      .get<IaTypeInfo[]>('/inventory-adjustments/types')
      .then((r) => setTypes(r.data))
      .catch(() => setTypes([]));
    api
      .get<{ id: string; name: string | null; oracleId: string }[]>('/classes/options')
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]));
  }, []);

  // FR-IA-05: the material list depends on the chosen type's stock bucket.
  useEffect(() => {
    if (noWarehouse || !type) {
      setMaterials([]);
      return;
    }
    api
      .get<AdjMaterialOption[]>('/inventory-adjustments/materials', {
        params: { adjustment_type: type },
      })
      .then((r) => setMaterials(r.data))
      .catch(() => setMaterials([]));
  }, [activeWarehouseId, noWarehouse, type]);

  // Reset every line when the warehouse changes.
  useEffect(() => {
    setGroups([]);
    setSelectedDiscs(new Set());
  }, [activeWarehouseId]);

  const materialIds = useMemo(() => groups.map((g) => g.material_id), [groups]);
  const materialIdsKey = materialIds.join(',');

  // FR-IA-10: the discrepancy list follows the picked materials, and only exists
  // for the two Discrepancy types.
  const loadDiscrepancies = useCallback(() => {
    if (!type || !rule?.discrepancy_list || materialIds.length === 0) {
      setDiscrepancies([]);
      return;
    }
    api
      .get<AdjDiscrepancyOption[]>('/inventory-adjustments/discrepancies', {
        params: { adjustment_type: type, material_ids: materialIds.join(',') },
      })
      .then((r) => setDiscrepancies(r.data))
      .catch(() => setDiscrepancies([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, rule?.discrepancy_list, materialIdsKey]);

  useEffect(loadDiscrepancies, [loadDiscrepancies]);

  /** FR-IA-01 rule 4: changing the type resets every line, after a confirmation. */
  function changeType(t: string) {
    const next = t as IaType;
    if (next === type) return;
    if (groups.length > 0) {
      const ok = window.confirm(
        'Changing the IA Type clears every material, bin, qty and discrepancy already selected. Continue?',
      );
      if (!ok) return;
    }
    setType(next);
    setGroups([]);
    setSelectedDiscs(new Set());
    setDiscrepancies([]);
  }

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
    if (!m || !m.material_id || !type) return;
    setGroups((gs) => [
      ...gs,
      {
        material_id: m.material_id as string,
        material_code: m.material_code,
        material_name: m.material_name,
        allows_decimal: m.allows_decimal ?? true,
        binOptions: [],
        binsLoaded: false,
        lines: [],
      },
    ]);
    try {
      const r = await api.get<AdjBinOption[]>('/inventory-adjustments/bins', {
        params: { material_id: m.material_id, adjustment_type: type },
      });
      setGroups((gs) =>
        gs.map((g) =>
          g.material_id === materialId ? { ...g, binOptions: r.data, binsLoaded: true } : g,
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
        // FR-IA-04 rule 4.
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
              qty_issue: opt.qty_issue,
              quality_issue: opt.quality_issue,
              // FR-IA-06/07: read-only, taken from the bucket.
              qty_adjustment: opt.suggested_qty_adjustment ?? 0,
              qty_passed: 0,
              qty_non_passed: 0,
            },
          ],
        };
      }),
    );
  }

  function removeBin(materialId: string, key: string) {
    setGroups((gs) =>
      gs.map((g) =>
        g.material_id === materialId
          ? { ...g, lines: g.lines.filter((l) => l.key !== key) }
          : g,
      ),
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

  /** What the bin's Available becomes once the document completes (FR-IA-14). */
  function newAvail(l: BinLine): number {
    switch (rule?.qty_mode) {
      // Discrepancy Quantity clears Quantity Issue; Discrepancy Quality is
      // Oracle-only. Neither touches Available in WMS.
      case 'auto_negative':
        return l.avail;
      case 'passed_non_passed':
        return l.avail + (Number(l.qty_passed) || 0);
      default:
        return l.avail + (Number(l.qty_adjustment) || 0);
    }
  }

  /** What the bin's Quality Issue becomes. */
  function newQualityIssue(l: BinLine): number {
    if (rule?.qty_mode !== 'passed_non_passed') return l.quality_issue;
    return l.quality_issue - (Number(l.qty_passed) || 0) - (Number(l.qty_non_passed) || 0);
  }

  // FR-IA-11 rule 2: an error message per line, not one banner for the document.
  const lineErrors = useMemo(() => {
    const errs = new Map<string, string>();
    if (!rule) return errs;
    for (const g of groups) {
      for (const l of g.lines) {
        const decimals = (...vals: number[]) =>
          !g.allows_decimal && vals.some((v) => Math.abs(v - Math.round(v)) > EPS);

        if (rule.qty_mode === 'passed_non_passed') {
          const passed = Number(l.qty_passed) || 0;
          const nonPassed = Number(l.qty_non_passed) || 0;
          const total = passed + nonPassed;
          if (passed < 0 || nonPassed < 0) {
            errs.set(l.key, 'Qty Passed and Qty Non-Passed must be positive');
          } else if (!(total > 0)) {
            errs.set(l.key, 'Enter Qty Passed and/or Qty Non-Passed');
          } else if (total > l.quality_issue + EPS) {
            errs.set(l.key, `Passed + Non-Passed (${total}) exceeds Quality Issue (${l.quality_issue})`);
          } else if (decimals(passed, nonPassed)) {
            errs.set(l.key, 'This unit of measure does not allow decimals');
          }
        } else if (rule.qty_mode === 'free_signed') {
          const qty = Number(l.qty_adjustment) || 0;
          if (Math.abs(qty) < EPS) {
            errs.set(l.key, 'Qty Adjustment cannot be 0');
          } else if (l.avail + qty < -EPS) {
            errs.set(l.key, `Exceeds available qty (${l.avail})`);
          } else if (decimals(qty)) {
            errs.set(l.key, 'This unit of measure does not allow decimals');
          }
        }
      }
    }
    return errs;
  }, [groups, rule]);

  const allLines = groups.flatMap((g) => g.lines);
  const emptyGroups = groups.filter((g) => g.lines.length === 0);
  const totalQty = allLines.reduce(
    (sum, l) =>
      sum +
      (rule?.qty_mode === 'passed_non_passed'
        ? (Number(l.qty_passed) || 0) + (Number(l.qty_non_passed) || 0)
        : Number(l.qty_adjustment) || 0),
    0,
  );

  const blockingMessage = (() => {
    if (!type) return 'Choose an IA Type first.';
    if (!classId) return 'Select a class.';
    if (allLines.length === 0) return 'Add at least one material and bin.';
    if (emptyGroups.length > 0) return 'Every material needs at least one bin.';
    if (lineErrors.size > 0) return 'Fix the highlighted lines before submitting.';
    return '';
  })();
  const canSave = !blockingMessage && !noWarehouse;

  function toggleDisc(id: string) {
    setSelectedDiscs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildItems() {
    return groups.flatMap((g) =>
      g.lines.map((l) => ({
        material_id: g.material_id,
        bin_id: l.bin_id,
        ...(rule?.qty_mode === 'passed_non_passed'
          ? { qty_passed: Number(l.qty_passed) || 0, qty_non_passed: Number(l.qty_non_passed) || 0 }
          : { qty_adjustment: Number(l.qty_adjustment) || 0 }),
      })),
    );
  }

  /** FR-IA-12 rule 1: the confirmation dialog IS the submission. */
  async function handleSubmit() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const r = await api.post<{ id: string; adjustment_number: string }>(
        '/inventory-adjustments',
        {
          adjustment_type: type,
          class_id: classId,
          memo: memo || undefined,
          items: buildItems(),
          discrepancy_ids: [...selectedDiscs],
        },
      );
      toast.success(`${r.data.adjustment_number} submitted for approval`);
      navigate(`/admin/inventory-adjustments/${r.data.id}`);
    } catch (err) {
      // Keep the dialog open so the user can see the error and retry.
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Submit failed');
      } else toast.error('Submit failed');
    } finally {
      setSaving(false);
    }
  }

  /** One line of the confirmation summary: what this line does to the bin. */
  function lineEffect(l: BinLine): string {
    switch (rule?.qty_mode) {
      case 'auto_negative':
        return rule.filter_bucket === 'qty_issue'
          ? 'Quantity Issue → 0'
          : 'Oracle only — no WMS bucket changes';
      case 'passed_non_passed': {
        const passed = Number(l.qty_passed) || 0;
        const total = passed + (Number(l.qty_non_passed) || 0);
        return `Available +${passed}, Quality Issue −${total}`;
      }
      default: {
        const qty = Number(l.qty_adjustment) || 0;
        return `Available ${qty >= 0 ? '+' : ''}${qty}`;
      }
    }
  }

  const qtyMode = rule?.qty_mode;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/admin/inventory-adjustments"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Create Inventory Adjustment</h1>
          <p className="mt-1 text-sm text-slate-500">
            Submitting sends the document straight to internal approval. Stock changes only after approval — and, where required, after Oracle approves.
          </p>
        </div>
      </div>

      {noWarehouse && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Select a specific warehouse from the top bar (not "All sites") to create an adjustment.
        </div>
      )}

      {/* Header */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Header</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <div className="mb-1 text-xs text-slate-400">Warehouse</div>
            <div className="input bg-slate-50">{activeWarehouseName ?? (canSwitch ? 'All sites' : '—')}</div>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">IA Type *</div>
            <SearchableSelect
              value={type}
              onChange={changeType}
              placeholder="Select IA Type…"
              searchPlaceholder="Search type…"
              options={types.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">Class *</div>
            <SearchableSelect
              value={classId}
              onChange={setClassId}
              placeholder="Select class…"
              searchPlaceholder="Search class…"
              options={classes.map((c) => ({
                value: c.id,
                label: c.name ? `${c.name} (${c.oracleId})` : c.oracleId,
              }))}
            />
          </div>
          <div className="sm:col-span-3">
            <div className="mb-1 text-xs text-slate-400">Memo (optional)</div>
            <input
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Reason or context for this adjustment…"
            />
            {rule && (
              <p className="mt-1 text-xs text-slate-400">
                Oracle receives:{' '}
                <span className="font-mono text-slate-500">
                  {memo.trim() ? `${rule.label} | ${memo.trim()}` : rule.label}
                </span>
              </p>
            )}
          </div>
        </div>

        {rule && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            {rule.qty_mode === 'auto_negative' && (
              <>
                Only bins with{' '}
                <b>{rule.filter_bucket === 'qty_issue' ? 'Quantity Issue' : 'Quality Issue'} &gt; 0</b> can be
                picked. Qty Adjustment is filled automatically with the whole bucket and cannot be edited.
              </>
            )}
            {rule.qty_mode === 'passed_non_passed' && (
              <>
                Only bins with <b>Quality Issue &gt; 0</b> can be picked. Both quantities reduce Quality Issue;
                only <b>Qty Passed</b> returns stock to Available and is sent to Oracle. A document with no Qty
                Passed at all is completed without ever reaching Oracle.
              </>
            )}
            {rule.qty_mode === 'free_signed' && (
              <>All bins are available. Enter a positive qty to add stock or a negative qty to reduce it.</>
            )}
          </div>
        )}
      </div>

      {/* Materials + bins */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Materials &amp; Bins</h3>
          <div className="w-72">
            <SearchableSelect
              value=""
              onChange={addMaterial}
              options={materialOptions}
              placeholder={type ? '+ Add material…' : 'Choose an IA Type first'}
              searchPlaceholder="Search material…"
              disabled={noWarehouse || !type}
            />
          </div>
        </div>

        {!type ? (
          <p className="text-sm text-slate-400">Select an IA Type to enable material selection.</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-400">
            {materials.length === 0
              ? 'No inventory matches this IA Type in the active warehouse.'
              : 'No material added yet. Choose a material to begin.'}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const binOpts = g.binOptions
                .filter((b) => b.bin_id && !g.lines.some((l) => l.bin_id === b.bin_id))
                .map((b) => ({ value: b.bin_id as string, label: b.bin_label ?? (b.bin_id as string) }));
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
                      {!g.allows_decimal && (
                        <div className="mt-0.5 text-xs text-slate-400">Whole numbers only (UoM)</div>
                      )}
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
                    <div className="px-4 py-3 text-xs text-amber-600">
                      No bin selected for this material — add one or remove the material.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-100 text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="px-4 py-2">Bin</th>
                            <th className="px-4 py-2 text-right">Available</th>
                            <th className="px-4 py-2 text-right">Qty Issue</th>
                            <th className="px-4 py-2 text-right">Quality Issue</th>
                            {qtyMode === 'passed_non_passed' ? (
                              <>
                                <th className="px-4 py-2 text-right">Qty Passed</th>
                                <th className="px-4 py-2 text-right">Qty Non-Passed</th>
                              </>
                            ) : (
                              <th className="px-4 py-2 text-right">
                                Qty Adjustment {qtyMode === 'free_signed' ? '(±)' : '(auto)'}
                              </th>
                            )}
                            <th className="px-4 py-2 text-right">After</th>
                            <th className="px-4 py-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {g.lines.map((l) => {
                            const err = lineErrors.get(l.key);
                            return (
                              <tr key={l.key} className={err ? 'bg-rose-50/50' : undefined}>
                                <td className="px-4 py-2 font-medium text-slate-800">
                                  {l.bin_label ?? l.bin_id}
                                  {err && <div className="mt-0.5 text-xs font-normal text-rose-600">{err}</div>}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-600">{l.avail}</td>
                                <td className="px-4 py-2 text-right text-slate-600">{l.qty_issue}</td>
                                <td className="px-4 py-2 text-right text-slate-600">{l.quality_issue}</td>

                                {qtyMode === 'passed_non_passed' ? (
                                  <>
                                    <td className="px-4 py-2">
                                      <div className="flex justify-end">
                                        <input
                                          type="number"
                                          step={g.allows_decimal ? 'any' : '1'}
                                          min={0}
                                          className="input w-24 text-right"
                                          value={l.qty_passed}
                                          onChange={(e) =>
                                            patchLine(g.material_id, l.key, {
                                              qty_passed: Number(e.target.value),
                                            })
                                          }
                                        />
                                      </div>
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex justify-end">
                                        <input
                                          type="number"
                                          step={g.allows_decimal ? 'any' : '1'}
                                          min={0}
                                          className="input w-24 text-right"
                                          value={l.qty_non_passed}
                                          onChange={(e) =>
                                            patchLine(g.material_id, l.key, {
                                              qty_non_passed: Number(e.target.value),
                                            })
                                          }
                                        />
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <td className="px-4 py-2">
                                    <div className="flex justify-end">
                                      {qtyMode === 'auto_negative' ? (
                                        // FR-IA-06/07: read-only, whole bucket, always negative.
                                        <span
                                          className="input w-24 bg-slate-100 text-right font-semibold text-slate-700"
                                          title="Filled automatically from the bin's issue quantity"
                                        >
                                          {l.qty_adjustment}
                                        </span>
                                      ) : (
                                        <input
                                          type="number"
                                          step={g.allows_decimal ? 'any' : '1'}
                                          className="input w-24 text-right"
                                          value={l.qty_adjustment}
                                          onChange={(e) =>
                                            patchLine(g.material_id, l.key, {
                                              qty_adjustment: Number(e.target.value),
                                            })
                                          }
                                        />
                                      )}
                                    </div>
                                  </td>
                                )}

                                <td className="px-4 py-2 text-right text-xs">
                                  {qtyMode === 'auto_negative' ? (
                                    rule?.filter_bucket === 'qty_issue' ? (
                                      <span className="text-slate-500">
                                        Qty Issue → <b className="text-brand-700">0</b>
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">Oracle only</span>
                                    )
                                  ) : qtyMode === 'passed_non_passed' ? (
                                    <span className="text-slate-500">
                                      Avail <b className="text-brand-700">{newAvail(l)}</b>
                                      <br />
                                      Quality{' '}
                                      <b className={newQualityIssue(l) < 0 ? 'text-rose-600' : 'text-brand-700'}>
                                        {newQualityIssue(l)}
                                      </b>
                                    </span>
                                  ) : (
                                    <span className="text-slate-500">
                                      Avail{' '}
                                      <b className={newAvail(l) < 0 ? 'text-rose-600' : 'text-brand-700'}>
                                        {newAvail(l)}
                                      </b>
                                    </span>
                                  )}
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

      {/* FR-IA-10: discrepancy references — Discrepancy types only */}
      {rule?.discrepancy_list && (
        <div className="card p-5">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Discrepancy References
          </h3>
          <p className="mb-3 text-xs text-slate-400">
            Optional. Only {rule.discrepancy_list} discrepancies for the materials above are listed. Selecting one
            attaches it to the document as a reference — it does not change the discrepancy's own status.
          </p>
          {groups.length === 0 ? (
            <p className="text-sm text-slate-400">Add a material to see related discrepancies.</p>
          ) : discrepancies.length === 0 ? (
            <p className="text-sm text-slate-400">No matching discrepancy documents.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <tbody className="divide-y divide-slate-100">
                  {discrepancies.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={selectedDiscs.has(d.id)}
                          onChange={() => toggleDisc(d.id)}
                        />
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-800">{d.discrepancy_id}</td>
                      <td className="px-4 py-2 text-slate-600">{d.from ?? '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={`/admin/discrepancy/${d.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          Detail ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {blockingMessage && <span className="text-xs text-amber-600">{blockingMessage}</span>}
        <Link to="/admin/inventory-adjustments" className="btn-secondary">
          Cancel
        </Link>
        <button
          className="btn-primary"
          onClick={() => setConfirming(true)}
          disabled={!canSave}
        >
          Submit for Approval
        </button>
      </div>

      {/* FR-IA-12 rule 1: confirmation with a summary of the document. */}
      <Modal
        open={confirming}
        title="Submit this adjustment for approval?"
        onClose={() => (saving ? null : setConfirming(false))}
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="IA Type" value={rule?.label ?? '—'} />
            <Row
              label="Class"
              value={classes.find((c) => c.id === classId)?.name ?? classId}
            />
            <Row label="Warehouse" value={activeWarehouseName ?? '—'} />
            <Row label="Memo" value={memo.trim() || '—'} />
            <Row label="Materials" value={groups.length} />
            <Row label="Bin lines" value={allLines.length} />
            <Row
              label="Discrepancy refs"
              value={rule?.discrepancy_list ? selectedDiscs.size : '—'}
            />
            <Row label="Total qty" value={totalQty} />
          </dl>

          <div>
            <div className="mb-1 text-xs text-slate-400">Memo sent to Oracle</div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
              {rule ? (memo.trim() ? `${rule.label} | ${memo.trim()}` : rule.label) : '—'}
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Bin</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Effect if approved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.flatMap((g) =>
                  g.lines.map((l) => (
                    <tr key={l.key}>
                      <td className="px-3 py-2 font-medium text-slate-700">{g.material_code}</td>
                      <td className="px-3 py-2 text-slate-600">{l.bin_label ?? l.bin_id}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {rule?.qty_mode === 'passed_non_passed'
                          ? `${l.qty_passed} / ${l.qty_non_passed}`
                          : l.qty_adjustment}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{lineEffect(l)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
            {rule?.qty_mode === 'passed_non_passed' && (
              <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-400">
                Qty column shows Passed / Non-Passed.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Once confirmed the document goes straight to internal approval and{' '}
            <b>can no longer be edited or deleted</b>. A correction requires a new
            Inventory Adjustment document. Stock changes only after approval — and,
            where required, after Oracle approves.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              className="btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={saving}
            >
              Cancel
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
