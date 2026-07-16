import { useEffect, useState } from 'react';
import Modal from './Modal';
import SearchableSelect from './SearchableSelect';
import type { Pickable, PickableItem } from '../types';

export interface PickAllocation {
  itemId: string;
  binId: string;
  qty: number;
  pickerId: number;
}

// One bin allocation row for a material. A material can be picked from more
// than one bin, each with its own qty and picker.
interface Alloc {
  binId: string;
  qty: number;
  pickerId: string;
}
interface ItemForm {
  selected: boolean;
  allocations: Alloc[];
}

interface Props {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  pickable: Pickable | null;
  pickers: { id: number; name: string }[];
  // "remaining" for SO, "remaining (committed)" for TO — only wording.
  remainingHint?: string;
  // Error from loading the pickable data (set by the parent).
  loadError?: string;
  onClose: () => void;
  // Resolves on success (parent closes/reloads); throw an Error to surface the
  // message inside the modal.
  onSubmit: (allocations: PickAllocation[]) => Promise<void>;
}

function newAlloc(it: PickableItem, qty: number): Alloc {
  return { binId: it.available_bins[0]?.bin_id ?? '', qty, pickerId: '' };
}

export default function GeneratePickingModal({
  open,
  loading,
  submitting,
  pickable,
  pickers,
  remainingHint,
  loadError,
  onClose,
  onSubmit,
}: Props) {
  const [forms, setForms] = useState<Record<string, ItemForm>>({});
  const [error, setError] = useState('');

  // Rebuild the form whenever a fresh pickable is loaded.
  useEffect(() => {
    setError('');
    if (!pickable) {
      setForms({});
      return;
    }
    setForms(
      Object.fromEntries(
        pickable.items.map((it) => [
          it.id,
          { selected: false, allocations: [newAlloc(it, it.remaining_qty)] } as ItemForm,
        ]),
      ),
    );
  }, [pickable]);

  function patchItem(itemId: string, patch: Partial<ItemForm>) {
    setForms((f) => ({ ...f, [itemId]: { ...f[itemId], ...patch } }));
  }
  function patchAlloc(itemId: string, idx: number, patch: Partial<Alloc>) {
    setForms((f) => {
      const item = f[itemId];
      const allocations = item.allocations.map((a, i) => (i === idx ? { ...a, ...patch } : a));
      return { ...f, [itemId]: { ...item, allocations } };
    });
  }
  function binAvail(it: PickableItem, binId: string): number | null {
    if (!binId) return null;
    return it.available_bins.find((b) => b.bin_id === binId)?.avail_qty ?? null;
  }

  async function handleSubmit() {
    if (!pickable) return;
    setError('');
    const chosen = pickable.items.filter((it) => forms[it.id]?.selected);
    if (chosen.length === 0) {
      setError('Select at least one item.');
      return;
    }

    const allocations: PickAllocation[] = [];
    for (const it of chosen) {
      const f = forms[it.id];
      const label = it.item_name ?? it.material_code ?? '—';
      const seenBins = new Set<string>();
      let total = 0;
      for (const a of f.allocations) {
        if (!a.binId) {
          setError(`Bin source is required for "${label}".`);
          return;
        }
        if (seenBins.has(a.binId)) {
          setError(`The same bin is selected more than once for "${label}".`);
          return;
        }
        seenBins.add(a.binId);
        const qty = Number(a.qty);
        if (!(qty > 0)) {
          setError(`Qty must be greater than 0 for "${label}".`);
          return;
        }
        const avail = binAvail(it, a.binId);
        if (avail != null && qty > avail) {
          setError(`Qty (${qty}) exceeds available stock (${avail}) in the selected bin for "${label}".`);
          return;
        }
        if (!a.pickerId) {
          setError(`Picker is required for "${label}".`);
          return;
        }
        total += qty;
        allocations.push({ itemId: it.id, binId: a.binId, qty, pickerId: Number(a.pickerId) });
      }
      if (total > it.remaining_qty + 1e-9) {
        setError(
          `Total qty (${total}) across bins exceeds remaining (${it.remaining_qty}) for "${label}".`,
        );
        return;
      }
    }

    try {
      await onSubmit(allocations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    }
  }

  return (
    <Modal
      open={open}
      title="Generate Picking"
      maxWidthClass="max-w-3xl"
      onClose={() => (submitting ? null : onClose())}
    >
      <div className="space-y-4">
        {(error || loadError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error || loadError}
          </div>
        )}
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-400">Loading picking data…</div>
        ) : !pickable || pickable.items.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No items with remaining quantity to pick.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Select items, quantity, bin source, and picker. Partial item and partial qty are
              supported; qty cannot exceed {remainingHint ?? 'remaining'}.
            </p>
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {pickable.items.map((it) => {
                const f = forms[it.id];
                if (!f) return null;
                return (
                  <div key={it.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={f.selected}
                        onChange={(e) => patchItem(it.id, { selected: e.target.checked })}
                      />
                      {it.item_name ?? it.material_code ?? '—'}
                      <span className="text-xs font-normal text-slate-400">
                        ({it.material_code ?? 'unmatched'}) · Remaining: {it.remaining_qty}
                      </span>
                    </label>

                    {f.selected && (
                      <div className="mt-3 space-y-2">
                        {it.available_bins.length === 0 && (
                          <p className="text-[11px] text-amber-600">
                            No bin with stock for this material.
                          </p>
                        )}
                        {f.allocations.map((a, idx) => {
                          const avail = binAvail(it, a.binId);
                          return (
                            <div
                              key={idx}
                              className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-[1fr_auto_1fr]"
                            >
                              <div>
                                <label className="block text-xs text-slate-400">Bin Source</label>
                                <SearchableSelect
                                  className="mt-0.5"
                                  value={a.binId}
                                  onChange={(v) => patchAlloc(it.id, idx, { binId: v })}
                                  placeholder="— Select —"
                                  searchPlaceholder="Search bin…"
                                  options={it.available_bins.map((b) => ({
                                    value: b.bin_id ?? '',
                                    label: `${b.bin_label ?? '—'} (avail ${b.avail_qty})`,
                                  }))}
                                />
                                {avail != null && (
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    Available in bin: <span className="font-medium">{avail}</span>
                                  </p>
                                )}
                              </div>
                              <div className="w-24">
                                <label className="block text-xs text-slate-400">Qty</label>
                                <input
                                  type="number"
                                  step="any"
                                  min={0}
                                  max={avail ?? undefined}
                                  className="input mt-0.5 w-full text-right text-sm"
                                  value={a.qty}
                                  onChange={(e) =>
                                    patchAlloc(it.id, idx, { qty: Number(e.target.value) })
                                  }
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-400">Picker</label>
                                <SearchableSelect
                                  className="mt-0.5"
                                  value={a.pickerId}
                                  onChange={(v) => patchAlloc(it.id, idx, { pickerId: v })}
                                  placeholder="— Select —"
                                  searchPlaceholder="Search picker…"
                                  options={pickers.map((p) => ({
                                    value: String(p.id),
                                    label: p.name,
                                  }))}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || loading || !pickable || pickable.items.length === 0}
          >
            {submitting ? 'Generating…' : 'Generate Picking'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
