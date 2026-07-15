import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  AdjBinOption,
  AdjMaterialOption,
  DiscrepancyRow,
  Paginated,
} from '../../types';
import { useToast } from '../../context/ToastContext';
import { useWarehouse } from '../../context/WarehouseContext';
import SearchableSelect from '../../components/SearchableSelect';

type AdjType = 'qty_issue' | 'quality_issue';

interface BinLine {
  key: string;
  bin_id: string;
  bin_label: string | null;
  avail: number;
  qty_issue: number;
  quality_issue: number;
  qty_adjustment: number;
  qty_scrapped: number;
  qty_passed: number;
}

interface Group {
  material_id: string;
  material_code: string | null;
  material_name: string | null;
  binOptions: AdjBinOption[];
  binsLoaded: boolean;
  lines: BinLine[];
}

let seq = 0;
const nextKey = () => `l-${seq++}`;

export default function InventoryAdjustmentCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWarehouseId, activeWarehouseName, canSwitch } = useWarehouse();

  const [type, setType] = useState<AdjType>('qty_issue');
  const [note, setNote] = useState('');
  const [classes, setClasses] = useState<{ id: string; name: string | null; oracleId: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [materials, setMaterials] = useState<AdjMaterialOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRow[]>([]);
  const [selectedDiscs, setSelectedDiscs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Admin with "All sites" selected cannot create — needs a concrete warehouse.
  const noWarehouse = canSwitch && !activeWarehouseId;

  // Class options (header select; oracle_id is sent to Oracle on approval).
  useEffect(() => {
    api
      .get<{ id: string; name: string | null; oracleId: string }[]>('/classes/options')
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]));
  }, []);

  // Load material options (scoped to the active warehouse via the header).
  useEffect(() => {
    if (noWarehouse) {
      setMaterials([]);
      return;
    }
    api
      .get<AdjMaterialOption[]>('/inventory-adjustments/materials')
      .then((r) => setMaterials(r.data))
      .catch(() => setMaterials([]));
    // reset selections when the warehouse changes
    setGroups([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWarehouseId, noWarehouse]);

  // Load discrepancy docs matching the adjustment type; reset selection.
  useEffect(() => {
    const discType = type === 'qty_issue' ? 'quantity' : 'quality';
    setSelectedDiscs(new Set());
    api
      .get<Paginated<DiscrepancyRow>>('/discrepancy', {
        params: { page: 1, limit: 100, type: discType },
      })
      .then((r) => setDiscrepancies(r.data.rows))
      .catch(() => setDiscrepancies([]));
  }, [type]);

  // Switching type clears the per-bin qty inputs (fields differ per type).
  function changeType(t: AdjType) {
    setType(t);
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        lines: g.lines.map((l) => ({
          ...l,
          qty_adjustment: 0,
          qty_scrapped: 0,
          qty_passed: 0,
        })),
      })),
    );
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
    if (!m || !m.material_id) return;
    const group: Group = {
      material_id: m.material_id,
      material_code: m.material_code,
      material_name: m.material_name,
      binOptions: [],
      binsLoaded: false,
      lines: [],
    };
    setGroups((gs) => [...gs, group]);
    try {
      const r = await api.get<AdjBinOption[]>('/inventory-adjustments/bins', {
        params: { material_id: m.material_id },
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
        gs.map((g) =>
          g.material_id === materialId ? { ...g, binsLoaded: true } : g,
        ),
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
              qty_adjustment: 0,
              qty_scrapped: 0,
              qty_passed: 0,
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
          ? {
              ...g,
              lines: g.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
            }
          : g,
      ),
    );
  }

  const allLines = groups.flatMap((g) => g.lines);

  // Simulated new available for a bin line (frontend-only, not persisted).
  //  qty_issue    → available + qty_adjustment (signed)
  //  quality_issue→ available − (scrapped + passed)
  const lineNewAvail = (l: BinLine) =>
    type === 'qty_issue'
      ? l.avail + (Number(l.qty_adjustment) || 0)
      : l.avail - (Number(l.qty_scrapped) || 0) - (Number(l.qty_passed) || 0);

  const validity = useMemo(() => {
    if (allLines.length === 0) return { ok: false, msg: 'Add at least one material and bin.' };
    for (const l of allLines) {
      if (type === 'qty_issue') {
        if ((Number(l.qty_adjustment) || 0) === 0)
          return { ok: false, msg: 'Enter a non-zero qty adjustment for every bin.' };
        if (lineNewAvail(l) < -1e-9)
          return { ok: false, msg: `Adjustment makes available negative for bin ${l.bin_label ?? ''}.` };
      } else {
        const t = l.qty_scrapped + l.qty_passed;
        if (!(t > 0)) return { ok: false, msg: 'Enter scrapped/passed for every bin.' };
        if (lineNewAvail(l) < -1e-9)
          return { ok: false, msg: `Scrapped+passed exceeds available (${l.avail}) for bin ${l.bin_label ?? ''}.` };
      }
    }
    return { ok: true, msg: '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLines, type]);

  function toggleDisc(id: string) {
    setSelectedDiscs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!classId) {
      toast.error('Select a class.');
      return;
    }
    if (!validity.ok) {
      toast.error(validity.msg);
      return;
    }
    const items = allLinesToItems();
    setSaving(true);
    try {
      const r = await api.post<{ id: string; adjustment_number: string }>(
        '/inventory-adjustments',
        {
          adjustment_type: type,
          class_id: classId,
          note: note || undefined,
          items,
          discrepancy_ids: [...selectedDiscs],
        },
      );
      toast.success(`Adjustment ${r.data.adjustment_number} created (Pending Approval)`);
      navigate(`/admin/inventory-adjustments/${r.data.id}`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Create failed');
      } else toast.error('Create failed');
    } finally {
      setSaving(false);
    }
  }

  function allLinesToItems() {
    return groups.flatMap((g) =>
      g.lines.map((l) => ({
        material_id: g.material_id,
        bin_id: l.bin_id,
        ...(type === 'qty_issue'
          ? { qty_adjustment: l.qty_adjustment }
          : { qty_scrapped: l.qty_scrapped, qty_passed: l.qty_passed }),
      })),
    );
  }

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
          <p className="mt-1 text-sm text-slate-500">Records a qty/quality issue for approval — no inventory change yet.</p>
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
            <div className="mb-1 text-xs text-slate-400">Adjustment Type</div>
            <SearchableSelect
              value={type}
              onChange={(v) => changeType(v as AdjType)}
              options={[
                { value: 'qty_issue', label: 'Qty Issue' },
                { value: 'quality_issue', label: 'Quality Issue' },
              ]}
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
          <div>
            <div className="mb-1 text-xs text-slate-400">Note (optional)</div>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Header description…" />
          </div>
        </div>
      </div>

      {/* Materials + bins */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Materials & Bins</h3>
          <div className="w-72">
            <SearchableSelect
              value=""
              onChange={addMaterial}
              options={materialOptions}
              placeholder="+ Add material…"
              searchPlaceholder="Search material…"
              disabled={noWarehouse}
            />
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-slate-400">No material added yet. Choose a material to begin.</p>
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
                        {g.material_name ? <span className="ml-2 text-xs text-slate-400">{g.material_name}</span> : null}
                      </div>
                      {g.lines.length > 0 && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          Total available:{' '}
                          <span className="text-slate-400">
                            {g.lines.reduce((s, l) => s + l.avail, 0)}
                          </span>{' '}
                          →{' '}
                          <span
                            className={`font-semibold ${
                              g.lines.reduce((s, l) => s + lineNewAvail(l), 0) < 0
                                ? 'text-rose-600'
                                : 'text-brand-700'
                            }`}
                          >
                            {g.lines.reduce((s, l) => s + lineNewAvail(l), 0)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-52">
                        <SearchableSelect
                          value=""
                          onChange={(v) => addBin(g.material_id, v)}
                          options={binOpts}
                          placeholder={g.binsLoaded ? '+ Add bin…' : 'Loading bins…'}
                          searchPlaceholder="Search bin…"
                          disabled={!g.binsLoaded}
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
                    <div className="px-4 py-3 text-xs text-slate-400">No bin selected for this material.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-100 text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="px-4 py-2">Bin</th>
                            <th className="px-4 py-2 text-right">Available</th>
                            <th className="px-4 py-2 text-right">Qty Issue</th>
                            <th className="px-4 py-2 text-right">Quality Issue</th>
                            {type === 'qty_issue' ? (
                              <th className="px-4 py-2 text-right">Qty Adjustment (±)</th>
                            ) : (
                              <>
                                <th className="px-4 py-2 text-right">Qty Scrapped</th>
                                <th className="px-4 py-2 text-right">Qty Passed</th>
                              </>
                            )}
                            <th className="px-4 py-2 text-right">New Available</th>
                            <th className="px-4 py-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {g.lines.map((l) => (
                            <tr key={l.key}>
                              <td className="px-4 py-2 font-medium text-slate-800">{l.bin_label ?? l.bin_id}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{l.avail}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{l.qty_issue}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{l.quality_issue}</td>
                              {type === 'qty_issue' ? (
                                <td className="px-4 py-2">
                                  <div className="flex justify-end">
                                    <input
                                      type="number" step="any"
                                      className="input w-24 text-right"
                                      value={l.qty_adjustment}
                                      onChange={(e) => patchLine(g.material_id, l.key, { qty_adjustment: Number(e.target.value) })}
                                    />
                                  </div>
                                </td>
                              ) : (
                                <>
                                  <td className="px-4 py-2">
                                    <div className="flex justify-end">
                                      <input
                                        type="number" step="any" min={0}
                                        className="input w-24 text-right"
                                        value={l.qty_scrapped}
                                        onChange={(e) => patchLine(g.material_id, l.key, { qty_scrapped: Number(e.target.value) })}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-4 py-2">
                                    <div className="flex justify-end">
                                      <input
                                        type="number" step="any" min={0}
                                        className="input w-24 text-right"
                                        value={l.qty_passed}
                                        onChange={(e) => patchLine(g.material_id, l.key, { qty_passed: Number(e.target.value) })}
                                      />
                                    </div>
                                  </td>
                                </>
                              )}
                              <td
                                className={`px-4 py-2 text-right font-semibold ${
                                  lineNewAvail(l) < 0 ? 'text-rose-600' : 'text-brand-700'
                                }`}
                              >
                                {lineNewAvail(l)}
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
                          ))}
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

      {/* Discrepancy memo */}
      <div className="card p-5">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Discrepancy Documents (memo)
        </h3>
        <p className="mb-3 text-xs text-slate-400">
          Optional. Only {type === 'qty_issue' ? 'quantity' : 'quality'} discrepancies are shown. Open Detail in a new tab before selecting.
        </p>
        {discrepancies.length === 0 ? (
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
                    <td className="px-4 py-2 text-slate-600">{d.source ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-500">{d.detail_count} item(s)</td>
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

      <div className="flex items-center justify-end gap-3">
        {!validity.ok && allLines.length > 0 && (
          <span className="text-xs text-amber-600">{validity.msg}</span>
        )}
        <Link to="/admin/inventory-adjustments" className="btn-secondary">Cancel</Link>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving || noWarehouse || !classId || !validity.ok}>
          {saving ? 'Saving…' : 'Create Adjustment'}
        </button>
      </div>
    </div>
  );
}
