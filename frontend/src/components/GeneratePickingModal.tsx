import { useEffect, useState, type ReactNode } from 'react';
import SearchableSelect from './SearchableSelect';
import type { Pickable, PickableItem } from '../types';

export interface PickAllocation {
  itemId: string;
  binId: string;
  qty: number;
  pickerId: number;
}

// One material's choices: the bin it is picked from, how much, and by whom.
interface ItemForm {
  binId: string;
  qty: number;
  pickerId: string;
}

interface Props {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  pickable: Pickable | null;
  pickers: { id: number; name: string }[];
  /** Read-only document header (Transaction ID, Doc Type, Warehouse, …), as on WMS dev. */
  docInfo?: { label: string; value: ReactNode }[];
  // "remaining" for SO, "remaining (committed)" for TO — only wording.
  remainingHint?: string;
  // Error from loading the pickable data (set by the parent).
  loadError?: string;
  /**
   * The materials to pick, chosen on the detail page (as on WMS dev, the modal
   * itself has no selection). Empty or absent = every pickable material.
   */
  preselectedIds?: string[];
  onClose: () => void;
  // Resolves on success (parent closes/reloads); throw an Error to surface the
  // message inside the modal.
  onSubmit: (allocations: PickAllocation[]) => Promise<void>;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

function binAvail(it: PickableItem, binId: string): number | null {
  if (!binId) return null;
  return (it.available_bins ?? []).find((b) => b.bin_id === binId)?.avail_qty ?? null;
}

/** First bin with stock, and as much of the remaining qty as it holds. */
function initialForm(it: PickableItem): ItemForm {
  const bin = (it.available_bins ?? [])[0];
  return {
    binId: bin?.bin_id ?? '',
    qty: bin ? Math.min(it.remaining_qty, bin.avail_qty) : it.remaining_qty,
    pickerId: '',
  };
}

/**
 * Generate Picking List — laid out like WMS dev's: the document's header
 * fields, then the Material List with Bin, Quantity, UoM and Picker per
 * material. On top of WMS dev: every row shows the PN / material code, and the
 * table's first row sets one picker for every material.
 */
export default function GeneratePickingModal({
  open,
  loading,
  submitting,
  pickable,
  pickers,
  docInfo,
  remainingHint,
  loadError,
  preselectedIds,
  onClose,
  onSubmit,
}: Props) {
  const [forms, setForms] = useState<Record<string, ItemForm>>({});
  const [error, setError] = useState('');
  // One picker for every line, so a long order is not assigned row by row.
  const [pickerForAll, setPickerForAll] = useState('');

  // Rebuild the form whenever a fresh pickable is loaded.
  useEffect(() => {
    setError('');
    setPickerForAll('');
    setForms(
      pickable ? Object.fromEntries(pickable.items.map((it) => [it.id, initialForm(it)])) : {},
    );
  }, [pickable]);

  // Close on Escape, like the other dialogs.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !submitting && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const all = pickable?.items ?? [];
  const items = preselectedIds?.length ? all.filter((it) => preselectedIds.includes(it.id)) : all;
  const totalQty = items.reduce((s, it) => s + (Number(forms[it.id]?.qty) || 0), 0);
  const pickerOptions = pickers.map((p) => ({ value: String(p.id), label: p.name }));

  function patch(itemId: string, p: Partial<ItemForm>) {
    setForms((f) => ({ ...f, [itemId]: { ...f[itemId], ...p } }));
  }
  /** Give every material this picker; a row can still be changed after. */
  function applyPickerToAll(pickerId: string) {
    setPickerForAll(pickerId);
    setForms((f) =>
      Object.fromEntries(Object.entries(f).map(([id, row]) => [id, { ...row, pickerId }])),
    );
  }

  async function handleSubmit() {
    setError('');
    if (items.length === 0) {
      setError('There is no material to pick.');
      return;
    }
    const allocations: PickAllocation[] = [];
    for (const it of items) {
      const f = forms[it.id];
      const label = it.material_code ?? it.item_name ?? '—';
      if (!f?.binId) {
        setError(`Bin is required for ${label}.`);
        return;
      }
      const qty = Number(f.qty);
      if (!(qty > 0)) {
        setError(`Quantity must be greater than 0 for ${label}.`);
        return;
      }
      if (qty > it.remaining_qty + 1e-9) {
        setError(`Quantity (${qty}) exceeds remaining (${it.remaining_qty}) for ${label}.`);
        return;
      }
      const avail = binAvail(it, f.binId);
      if (avail != null && qty > avail) {
        setError(`Quantity (${qty}) exceeds available stock (${avail}) in the bin for ${label}.`);
        return;
      }
      if (!f.pickerId) {
        setError(`Picker is required for ${label}.`);
        return;
      }
      allocations.push({ itemId: it.id, binId: f.binId, qty, pickerId: Number(f.pickerId) });
    }
    try {
      await onSubmit(allocations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    }
  }

  const th =
    'sticky top-0 z-10 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400';
  const td = 'border-b border-neutral-100 px-3 py-3 align-middle dark:border-slate-700/70';
  const readonlyBox =
    'flex h-9 items-center rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={() => !submitting && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-picking-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.32)] dark:border-slate-700 dark:bg-slate-800"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5 dark:border-slate-700">
          <div>
            <h2
              id="gen-picking-title"
              className="text-2xl font-semibold leading-snug text-neutral-900 dark:text-white"
            >
              Generate Picking List
            </h2>
            <p className="mt-1 text-[13px] text-neutral-500 dark:text-slate-400">
              Choose the bin, quantity and picker for each material. Quantity cannot exceed{' '}
              {remainingHint ?? 'remaining'} or the stock available in the bin.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-slate-700"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {(error || loadError) && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
              </svg>
              {error || loadError}
            </div>
          )}

          {docInfo && docInfo.length > 0 && (
            <section className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/30">
              {docInfo.map((f) => (
                <div key={f.label}>
                  <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-slate-400">{f.label}</div>
                  <div className={readonlyBox}>
                    <span className="truncate">{f.value || '-'}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Material List */}
          <section className="overflow-hidden rounded-xl border border-neutral-200 shadow-sm dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white">Material List</h3>
                <span className="rounded-full bg-[#E1E4F8] px-2 py-0.5 text-xs font-semibold text-[#5166AE] dark:bg-[#5166AE]/25 dark:text-[#c7cff0]">
                  {items.length} {items.length === 1 ? 'material' : 'materials'}
                </span>
              </div>
              <span className="text-xs text-neutral-500">
                Total qty <span className="font-semibold text-neutral-800 dark:text-slate-100">{fmt(totalQty)}</span>
              </span>
            </div>

            {loading ? (
              <div className="py-12 text-center text-sm text-neutral-400">Loading picking data…</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-neutral-400">
                No materials with remaining quantity to pick.
              </div>
            ) : (
              <div className="max-h-[52vh] overflow-auto">
                <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className={`${th} w-12`}>No</th>
                      <th className={th}>Material</th>
                      <th className={`${th} text-right`}>Remaining</th>
                      <th className={`${th} w-56`}>
                        Bin <span className="text-red-500">*</span>
                      </th>
                      <th className={`${th} text-right`}>Available</th>
                      <th className={`${th} w-28`}>
                        Quantity <span className="text-red-500">*</span>
                      </th>
                      <th className={th}>UoM</th>
                      <th className={`${th} w-56`}>
                        Picker <span className="text-red-500">*</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Picker for all items — set once, fills the Picker of every row below. */}
                    <tr className="bg-[#F5F6FD] dark:bg-[#5166AE]/10">
                      <td colSpan={7} className="border-b border-[#E1E4F8] px-3 py-3 dark:border-[#5166AE]/30">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E1E4F8] text-[#5166AE] dark:bg-[#5166AE]/30 dark:text-[#c7cff0]">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                          </span>
                          <div>
                            <div className="text-sm font-semibold text-[#3F4F8C] dark:text-[#c7cff0]">
                              Picker for all items
                            </div>
                            <div className="text-xs text-neutral-500">
                              Pick one here to assign it to all {items.length} materials — any row can still be changed.
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-[#E1E4F8] px-3 py-3 dark:border-[#5166AE]/30">
                        <SearchableSelect
                          value={pickerForAll}
                          onChange={applyPickerToAll}
                          placeholder="Assign to all…"
                          searchPlaceholder="Search picker…"
                          options={pickerOptions}
                        />
                      </td>
                    </tr>

                    {items.map((it, i) => {
                      const f = forms[it.id];
                      if (!f) return null;
                      const avail = binAvail(it, f.binId);
                      const qty = Number(f.qty) || 0;
                      const overAvail = avail != null && qty > avail;
                      const overRemaining = qty > it.remaining_qty + 1e-9;
                      const noBins = (it.available_bins ?? []).length === 0;
                      return (
                        <tr
                          key={it.id}
                          className="bg-white transition-colors hover:bg-neutral-50/80 dark:bg-slate-800 dark:hover:bg-slate-700/40"
                        >
                          <td className={`${td} text-neutral-400`}>{i + 1}</td>
                          <td className={td}>
                            <div className="max-w-[17rem]">
                              <div
                                className="truncate font-medium text-neutral-900 dark:text-white"
                                title={it.material_name ?? it.item_name ?? undefined}
                              >
                                {it.material_name ?? it.item_name ?? '—'}
                              </div>
                              {/* PN / material code, always shown at item level. */}
                              <span
                                className="mt-1 inline-flex max-w-full items-center truncate rounded-md bg-[#E1E4F8] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#5166AE] dark:bg-[#5166AE]/25 dark:text-[#c7cff0]"
                                title="PN / Material Code"
                              >
                                PN · {it.material_code ?? 'unmatched'}
                              </span>
                            </div>
                          </td>
                          <td className={`${td} text-right font-semibold tabular-nums text-neutral-800 dark:text-slate-100`}>
                            {fmt(it.remaining_qty)}
                          </td>
                          <td className={td}>
                            {noBins ? (
                              <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                                No bin with stock
                              </span>
                            ) : (
                              <SearchableSelect
                                value={f.binId}
                                onChange={(v) => {
                                  // Re-fit the qty to the new bin's stock.
                                  const a = binAvail(it, v);
                                  patch(it.id, {
                                    binId: v,
                                    qty: a != null ? Math.min(it.remaining_qty, a) : f.qty,
                                  });
                                }}
                                placeholder="Select bin…"
                                searchPlaceholder="Search bin…"
                                options={(it.available_bins ?? []).map((b) => ({
                                  value: b.bin_id ?? '',
                                  label: `${b.bin_label ?? '—'} (avail ${b.avail_qty})`,
                                }))}
                              />
                            )}
                          </td>
                          <td
                            className={`${td} text-right tabular-nums ${
                              overAvail ? 'font-semibold text-red-600' : 'text-neutral-600 dark:text-slate-300'
                            }`}
                          >
                            {avail == null ? '-' : fmt(avail)}
                          </td>
                          <td className={td}>
                            <input
                              type="number"
                              step="any"
                              min={0}
                              max={Math.min(it.remaining_qty, avail ?? it.remaining_qty)}
                              aria-invalid={overAvail || overRemaining}
                              className={`input w-full text-right text-sm tabular-nums ${
                                overAvail || overRemaining
                                  ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30'
                                  : ''
                              }`}
                              value={f.qty}
                              onChange={(e) => patch(it.id, { qty: Number(e.target.value) })}
                            />
                          </td>
                          <td className={`${td} text-neutral-600 dark:text-slate-300`}>{it.uom ?? '-'}</td>
                          <td className={td}>
                            <SearchableSelect
                              value={f.pickerId}
                              onChange={(v) => patch(it.id, { pickerId: v })}
                              placeholder="Select picker…"
                              searchPlaceholder="Search picker…"
                              options={pickerOptions}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50/60 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40">
          <p className="text-xs text-neutral-500">
            {items.length} material(s) · {fmt(totalQty)} qty will be reserved for picking
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-[#5166AE] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#43579a] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSubmit}
              disabled={submitting || loading || items.length === 0}
            >
              {submitting ? 'Generating…' : 'Generate Picking'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
