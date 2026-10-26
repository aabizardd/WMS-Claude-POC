import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  SalesDeliveryDetail,
  SalesDeliveryRow,
  SdBinOption,
} from '../../types';
import { useToast } from '../../context/ToastContext';
import SearchableSelect from '../../components/SearchableSelect';
import Modal from '../../components/Modal';
import { useFormDraft } from '../../hooks/useFormDraft';
import DraftBanner from './DraftBanner';
import {
  DocNumberField,
  EmptyState,
  FieldLabel,
  GridPager,
  QtyStepper,
  ReadOnlyField,
  Row,
  SectionHead,
} from './formParts';

/**
 * Create a Sales Return.
 *
 * Laid out like the Sales Delivery form, run backwards. Pick the delivery
 * being reversed and the header is copied from it:
 *  - From Location is the delivery's destination (a billing warehouse);
 *  - To Location is where the delivery came from;
 *  - department, class and customer are the delivery's own.
 *
 * The PN cards are the delivery's PNs. Ticking one lists, as its default bins,
 * the bins the delivery took it out of; more bins of the To Location that hold
 * the PN can be added. Each PN's total across its bins is capped by what the
 * delivery moved of it (the backend caps per material the same way).
 */
interface ReturnBin {
  key: string;
  bin_id: string;
  qty_transfer: number;
  remarks: string;
  /** Set when the row was copied from the delivery rather than added. */
  source_bin_id: string | null;
  source_bin_label: string | null;
}

interface ReturnLine {
  key: string;
  material_id: string;
  material_code: string | null;
  material_name: string | null;
  uom_code: string | null;
  /** What the source delivery moved of this PN, over all its bins. */
  max_qty: number;
  selected: boolean;
  expanded: boolean;
  bins: ReturnBin[];
  binOptions: SdBinOption[];
  binsLoaded: boolean;
}

let seq = 0;
const nextKey = () => `r-${seq++}`;
const EPS = 1e-9;
const PAGE_SIZES = [9, 18, 27];
const MEMO_MAX = 300;

const fmt = (n: number) => n.toLocaleString();

const newBin = (patch: Partial<ReturnBin> = {}): ReturnBin => ({
  key: nextKey(),
  bin_id: '',
  qty_transfer: 0,
  remarks: '',
  source_bin_id: null,
  source_bin_label: null,
  ...patch,
});

/** Bin rows that will actually be submitted: those with a quantity. */
const filledBins = (l: ReturnLine) =>
  l.bins.filter((b) => (Number(b.qty_transfer) || 0) > EPS);

const lineTotal = (l: ReturnLine) =>
  l.bins.reduce((s, b) => s + (Number(b.qty_transfer) || 0), 0);

/** What is kept per source delivery until the return is submitted. */
interface SrDraft {
  manualNumber: boolean;
  srNumber: string;
  memo: string;
  lines: { material_id: string; selected: boolean; expanded: boolean; bins: ReturnBin[] }[];
}

export default function SalesReturnCreatePage() {
  const navigate = useNavigate();
  // Opened from a delivery's "Sales Return" action: ?source=<delivery id>.
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceParam = searchParams.get('source');
  const toast = useToast();

  const [sources, setSources] = useState<SalesDeliveryRow[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [source, setSource] = useState<SalesDeliveryDetail | null>(null);
  const [copying, setCopying] = useState(false);

  const [manualNumber, setManualNumber] = useState(false);
  const [srNumber, setSrNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<ReturnLine[]>([]);

  const [pnSearch, setPnSearch] = useState('');
  const [pnPage, setPnPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Unsaved input survives a refresh or a failed submit, one draft per source
  // delivery. `draftSource` is the delivery whose draft the form is writing.
  const draftStore = useFormDraft<SrDraft>('sales-return');
  const [draftSource, setDraftSource] = useState('');
  const [restoredAt, setRestoredAt] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SalesDeliveryRow[]>('/sales-delivery/return-sources')
      .then((r) => setSources(r.data))
      .catch(() => setSources([]));
  }, []);

  // Preselect the delivery the user came from.
  useEffect(() => {
    if (sourceParam) pickSource(sourceParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceParam]);

  // The picked delivery stays selectable even when the eligible list does not
  // carry it (yet), so the select never shows a blank value.
  const sourceOptions = [
    ...sources,
    ...(source && !sources.some((s) => s.id === source.id) ? [source] : []),
  ].map((s) => ({
    value: s.id,
    label: `${s.delivery_number} · ${s.from_warehouse ?? '—'} → ${s.to_warehouse ?? '—'}`,
  }));

  /** Copy the chosen delivery: its header, and one PN card per material. */
  async function pickSource(id: string) {
    if (!id || id === sourceId) return;
    if (lines.some((l) => l.selected)) {
      const ok = window.confirm(
        'Changing the Sales Delivery clears every PN, bin and qty already entered. Continue?',
      );
      if (!ok) return;
    }
    setCopying(true);
    try {
      const r = await api.get<SalesDeliveryDetail>(`/sales-delivery/${id}`);
      const d = r.data;
      setSourceId(id);
      setSource(d);
      setPnSearch('');
      setPnPage(1);
      // The return runs the delivery backwards.
      const toWarehouseId = d.from_warehouse_id;

      // One line per PN; each bin the delivery used becomes one of its rows.
      const byMaterial = new Map<string, ReturnLine>();
      const copied: ReturnLine[] = [];
      for (const it of d.items) {
        const materialId = it.material_id ?? '';
        let line = materialId ? byMaterial.get(materialId) : undefined;
        if (!line) {
          line = {
            key: nextKey(),
            material_id: materialId,
            material_code: it.material_code,
            material_name: it.material_name,
            uom_code: it.uom_code,
            max_qty: 0,
            selected: false,
            expanded: true,
            bins: [],
            binOptions: [],
            binsLoaded: false,
          };
          if (materialId) byMaterial.set(materialId, line);
          copied.push(line);
        }
        line.max_qty += it.qty_transfer;
        if (!line.bins.some((b) => b.source_bin_id && b.source_bin_id === it.bin_id)) {
          // Qty starts at nothing: the user types how much actually came back.
          // Remarks are blank too: a return's note is about why it came back,
          // unrelated to the note typed when it was delivered.
          line.bins.push(
            newBin({ source_bin_id: it.bin_id, source_bin_label: it.bin_label }),
          );
        }
      }
      setLines(copied);
      setDraftSource('');
      // The URL carries the delivery, so a refresh reopens it (and its draft).
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('source', id);
          return next;
        },
        { replace: true },
      );

      // Bins come from the destination, not from the delivery's own bins.
      for (const line of copied) {
        if (!line.material_id) continue;
        try {
          const b = await api.get<SdBinOption[]>('/sales-delivery/return-bins', {
            params: { material_id: line.material_id, to_warehouse_id: toWarehouseId },
          });
          // Preselect the delivery's own bins when they are still a valid
          // choice; a lone row falls back to the only option there is.
          const offered = b.data.map((x) => x.bin_id).filter(Boolean) as string[];
          const preselect = (bin: ReturnBin, count: number) =>
            bin.source_bin_id && offered.includes(bin.source_bin_id)
              ? bin.source_bin_id
              : count === 1 && offered.length === 1
                ? offered[0]
                : '';
          setLines((ls) =>
            ls.map((l) =>
              l.key === line.key
                ? {
                    ...l,
                    binOptions: b.data,
                    binsLoaded: true,
                    bins: l.bins.map((bin) => ({
                      ...bin,
                      bin_id: preselect(bin, l.bins.length),
                    })),
                  }
                : l,
            ),
          );
        } catch {
          setLines((ls) =>
            ls.map((l) => (l.key === line.key ? { ...l, binsLoaded: true } : l)),
          );
        }
      }

      // Put back what was typed for this delivery before, if anything.
      const saved = draftStore.load(id);
      if (saved) {
        const byMaterial = new Map(saved.data.lines.map((l) => [l.material_id, l]));
        setLines((ls) =>
          ls.map((l) => {
            const s = byMaterial.get(l.material_id);
            return s
              ? {
                  ...l,
                  selected: s.selected,
                  expanded: s.expanded,
                  // Fresh keys: the saved ones came from an earlier page load
                  // and could clash with keys handed out since.
                  bins: s.bins.length ? s.bins.map((b) => ({ ...b, key: nextKey() })) : l.bins,
                }
              : l;
          }),
        );
        setManualNumber(saved.data.manualNumber);
        setSrNumber(saved.data.srNumber);
        setMemo(saved.data.memo);
        setRestoredAt(saved.savedAt);
      } else {
        setRestoredAt(null);
      }
      setDraftSource(id);
    } catch {
      toast.error('Could not load that Sales Delivery');
    } finally {
      setCopying(false);
    }
  }

  // Keep this delivery's draft in step with the form. Nothing picked, nothing kept.
  useEffect(() => {
    if (!draftSource || copying) return;
    const touched =
      lines.some((l) => l.selected) || memo.trim() !== '' || srNumber.trim() !== '';
    if (!touched) {
      draftStore.clear(draftSource);
      return;
    }
    draftStore.save(
      {
        manualNumber,
        srNumber,
        memo,
        lines: lines.map((l) => ({
          material_id: l.material_id,
          selected: l.selected,
          expanded: l.expanded,
          bins: l.bins,
        })),
      },
      draftSource,
    );
  }, [draftSource, copying, draftStore, manualNumber, srNumber, memo, lines]);

  function discardDraft() {
    if (draftSource) draftStore.clear(draftSource);
    window.location.reload();
  }

  function patchLine(key: string, patch: (l: ReturnLine) => Partial<ReturnLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch(l) } : l)));
  }

  function patchBin(lineKey: string, binKey: string, patch: Partial<ReturnBin>) {
    patchLine(lineKey, (l) => ({
      bins: l.bins.map((b) => (b.key === binKey ? { ...b, ...patch } : b)),
    }));
  }

  /** −/+ on the stepper, never below 0. Reads the latest qty so quick clicks add up. */
  function stepQty(lineKey: string, binKey: string, delta: number) {
    patchLine(lineKey, (l) => ({
      bins: l.bins.map((b) =>
        b.key === binKey
          ? { ...b, qty_transfer: Math.max(0, (Number(b.qty_transfer) || 0) + delta) }
          : b,
      ),
    }));
  }

  function addBin(lineKey: string) {
    patchLine(lineKey, (l) => ({ bins: [...l.bins, newBin()], expanded: true }));
  }

  function removeBin(lineKey: string, binKey: string) {
    patchLine(lineKey, (l) => ({ bins: l.bins.filter((b) => b.key !== binKey) }));
  }

  // ----- PN cards -----

  const selectedLines = lines.filter((l) => l.selected);

  const filteredLines = useMemo(() => {
    const q = pnSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        (l.material_code ?? '').toLowerCase().includes(q) ||
        (l.material_name ?? '').toLowerCase().includes(q),
    );
  }, [lines, pnSearch]);

  const pageCount = Math.max(1, Math.ceil(filteredLines.length / pageSize));
  const currentPage = Math.min(pnPage, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageLines = filteredLines.slice(pageStart, pageStart + pageSize);

  // Both sides come from the source delivery, reversed.
  const billingId = source?.to_warehouse_id ?? '';
  const billingName = source?.to_warehouse ?? '—';
  const toName = source?.from_warehouse ?? '—';
  const customerName = (() => {
    if (!source?.customer_name) return '—';
    return source.customer_entity_id
      ? `${source.customer_entity_id} — ${source.customer_name}`
      : source.customer_name;
  })();

  // One message per PN and per bin row, so the user sees exactly what is wrong.
  // Only ticked PNs count; a bin row left at 0 is simply not submitted.
  const { lineErrors, binErrors } = useMemo(() => {
    const lineErrs = new Map<string, string>();
    const binErrs = new Map<string, string>();
    for (const l of lines) {
      if (!l.selected) continue;
      const seenBins = new Set<string>();
      for (const b of l.bins) {
        const qty = Number(b.qty_transfer) || 0;
        if (qty < -EPS) binErrs.set(b.key, 'Qty cannot be negative');
        else if (qty > EPS && !b.bin_id) binErrs.set(b.key, 'Choose a bin');
        if (b.bin_id) {
          if (seenBins.has(b.bin_id)) binErrs.set(b.key, 'Bin already used for this PN');
          seenBins.add(b.bin_id);
        }
      }
      const total = lineTotal(l);
      if (total <= EPS) lineErrs.set(l.key, 'Enter how much came back');
      else if (total > l.max_qty + EPS) {
        lineErrs.set(l.key, `Total cannot exceed the ${fmt(l.max_qty)} delivered`);
      }
    }
    return { lineErrors: lineErrs, binErrors: binErrs };
  }, [lines]);

  const filledCount = selectedLines.reduce((s, l) => s + filledBins(l).length, 0);
  const totalQty = selectedLines.reduce((s, l) => s + lineTotal(l), 0);

  const trimmedNumber = srNumber.trim();
  const blockingMessage = (() => {
    if (manualNumber && !trimmedNumber) return 'Enter the SR Number, or switch back to System Format.';
    if (!sourceId) return 'Pick the Sales Delivery this return reverses.';
    if (selectedLines.length === 0) return 'Select at least one PN.';
    if (lineErrors.size > 0 || binErrors.size > 0) {
      return 'Fix the highlighted PNs before submitting.';
    }
    return '';
  })();
  const canSave = !blockingMessage;

  async function handleSubmit() {
    if (!canSave || saving || !source) return;
    setSaving(true);
    try {
      const r = await api.post<{ id: string; delivery_number: string }>(
        '/sales-delivery',
        {
          document_type: 'SalesReturn',
          delivery_number: manualNumber ? trimmedNumber : undefined,
          source_delivery_id: source.id,
          from_warehouse_id: billingId,
          to_warehouse_id: source.from_warehouse_id,
          // The header is the delivery's, unchanged.
          customer_id: source.customer_id ?? undefined,
          department_id: source.department_id,
          class_id: source.class_id,
          memo: memo.trim() || undefined,
          // One item per (PN, bin) that has a quantity.
          items: selectedLines.flatMap((l) =>
            filledBins(l).map((b) => ({
              material_id: l.material_id,
              bin_id: b.bin_id,
              qty_transfer: Number(b.qty_transfer) || 0,
              remarks: b.remarks.trim() || undefined,
            })),
          ),
        },
      );
      draftStore.clear(source.id);
      toast.success(`${r.data.delivery_number} submitted`);
      navigate(`/admin/inventory/sales-delivery/${r.data.id}`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        toast.error(Array.isArray(m) ? m.join(', ') : (m ?? 'Could not submit the return'));
      } else {
        toast.error('Could not submit the return');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-4">
      {restoredAt && <DraftBanner savedAt={restoredAt} onDiscard={discardDraft} />}
      {/* Header */}
      <div className="card p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/admin/inventory/sales-delivery?type=return"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Create Sales Return</h1>
        </div>

        <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-3">
          <DocNumberField
            label="SR Number"
            manual={manualNumber}
            value={srNumber}
            onManualChange={setManualNumber}
            onChange={setSrNumber}
          />
          <div className="md:col-span-2">
            <FieldLabel required>Sales Delivery</FieldLabel>
            <SearchableSelect
              value={sourceId}
              onChange={pickSource}
              placeholder="Select the Sales Delivery to return..."
              searchPlaceholder="Search delivery number…"
              disabled={copying}
              options={sourceOptions}
            />
            {copying ? (
              <p className="mt-1.5 text-xs text-slate-400">Copying the delivery…</p>
            ) : (
              source && (
                <a
                  href={`/admin/inventory/sales-delivery/${source.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Open {source.delivery_number} detail
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-9 9M5 7v12h12v-5" />
                  </svg>
                </a>
              )
            )}
          </div>

          <div>
            <FieldLabel>From Location (billing)</FieldLabel>
            <ReadOnlyField>{billingName}</ReadOnlyField>
          </div>
          <div>
            <FieldLabel>To Location</FieldLabel>
            <ReadOnlyField>{toName}</ReadOnlyField>
          </div>
          <div>
            <FieldLabel>Customer</FieldLabel>
            <ReadOnlyField>{customerName}</ReadOnlyField>
          </div>
          <div>
            <FieldLabel>Department</FieldLabel>
            <ReadOnlyField>{source?.department_name ?? '—'}</ReadOnlyField>
          </div>
          <div>
            <FieldLabel>Class</FieldLabel>
            <ReadOnlyField>{source?.class_name ?? '—'}</ReadOnlyField>
          </div>
          <div className="flex items-end">
            <p className="pb-2 text-xs text-slate-400">
              Locations, customer, department and class come from the Sales Delivery.
            </p>
          </div>

          <div className="md:col-span-3">
            <FieldLabel aside={`${memo.length}/${MEMO_MAX}`}>Memo</FieldLabel>
            <textarea
              className="input min-h-[84px] resize-y"
              value={memo}
              maxLength={MEMO_MAX}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Enter the reason for this return (optional)..."
            />
          </div>
        </div>
      </div>

      {/* Select PN */}
      <div className="card overflow-hidden">
        <SectionHead
          title="Select PN"
          subtitle="Pick the PNs that came back. The list is taken from the Sales Delivery above."
          badge={
            selectedLines.length > 0
              ? `${selectedLines.length} / ${lines.length} PN Selected`
              : undefined
          }
        />
        {!source ? (
          <EmptyState>
            Select a Sales Delivery first, the PN list is taken from that delivery.
          </EmptyState>
        ) : (
          <div className="space-y-4 p-5">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                className="input pl-9"
                value={pnSearch}
                onChange={(e) => {
                  setPnSearch(e.target.value);
                  setPnPage(1);
                }}
                placeholder="Search PN by code or name..."
              />
            </div>

            {selectedLines.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedLines.map((l) => (
                  <span
                    key={l.key}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs text-brand-700"
                  >
                    <b className="font-semibold">{l.material_code}</b>
                    {l.material_name && <span className="text-brand-600/80">({l.material_name})</span>}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full px-1 text-brand-500 hover:bg-brand-100 hover:text-brand-700"
                      onClick={() => patchLine(l.key, () => ({ selected: false }))}
                      aria-label={`Remove ${l.material_code}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {filteredLines.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                {lines.length === 0 ? 'This delivery has no items.' : 'No PN matches the search.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pageLines.map((l) => (
                    <label
                      key={l.key}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                        l.selected
                          ? 'border-brand-400 bg-brand-50/40 ring-1 ring-brand-200'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
                        checked={l.selected}
                        onChange={(e) =>
                          patchLine(l.key, () => ({ selected: e.target.checked, expanded: true }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-800">
                          {l.material_code ?? '—'}
                        </div>
                        <div className="truncate text-xs text-slate-500" title={l.material_name ?? ''}>
                          {l.material_name ?? '—'}
                        </div>
                      </div>
                      <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        {fmt(l.max_qty)} delivered
                      </span>
                    </label>
                  ))}
                </div>
                <GridPager
                  pageSize={pageSize}
                  pageSizes={PAGE_SIZES}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setPnPage(1);
                  }}
                  start={pageStart}
                  shown={pageLines.length}
                  total={filteredLines.length}
                  page={currentPage}
                  pageCount={pageCount}
                  onPage={setPnPage}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Select Bins — appears once there is a delivery to return. */}
      {source && (
        <div className="card overflow-hidden">
          <SectionHead
            title="Select Bins"
            subtitle={`Where each PN goes back to in ${toName}. The delivery's own bins are filled in; add more if the goods are split. A PN's total cannot exceed what was delivered.`}
            badge={filledCount > 0 ? `${filledCount} Bins Filled` : undefined}
          />
          {selectedLines.length === 0 ? (
            <EmptyState>Select a PN to choose bins.</EmptyState>
          ) : (
            <div className="space-y-4 p-5">
              {(lineErrors.size > 0 || binErrors.size > 0) && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
                  </svg>
                  Please enter a valid Qty Return for every selected PN. Its total cannot
                  exceed the delivered quantity or be zero.
                </div>
              )}

              {selectedLines.map((l) => {
                const err = lineErrors.get(l.key);
                const total = lineTotal(l);
                const allBinOpts = l.binOptions
                  .filter((b) => b.bin_id)
                  .map((b) => ({
                    value: b.bin_id as string,
                    label: b.bin_label ?? (b.bin_id as string),
                  }));
                const used = new Set(l.bins.map((b) => b.bin_id).filter(Boolean));
                const canAddBin = l.binsLoaded && used.size < allBinOpts.length;
                return (
                  <div
                    key={l.key}
                    className={`overflow-hidden rounded-lg border ${err ? 'border-rose-300' : 'border-slate-200'}`}
                  >
                    <div className="flex items-center gap-3 bg-slate-50 px-4 py-2.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => patchLine(l.key, (x) => ({ expanded: !x.expanded }))}
                      >
                        <span className="truncate text-sm font-semibold text-slate-800">
                          {l.material_code}
                        </span>
                        {l.material_name && (
                          <span className="truncate text-xs text-slate-500">({l.material_name})</span>
                        )}
                      </button>
                      {err && <span className="text-[11px] text-rose-600">{err}</span>}
                      <span
                        className={`rounded-full border bg-white px-2 py-0.5 text-[11px] ${
                          total > l.max_qty + EPS
                            ? 'border-rose-200 font-semibold text-rose-600'
                            : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {fmt(total)} / {fmt(l.max_qty)} returned
                      </span>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                        onClick={() => patchLine(l.key, (x) => ({ expanded: !x.expanded }))}
                        aria-expanded={l.expanded}
                        aria-label={l.expanded ? 'Collapse bins' : 'Expand bins'}
                      >
                        <svg
                          className={`h-4 w-4 transition-transform ${l.expanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    {l.expanded && (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                          <thead className="text-left text-xs text-slate-500">
                            <tr>
                              <th className="px-4 py-2 font-medium">Bin (at To Location)</th>
                              <th className="px-4 py-2 font-medium">Qty Return</th>
                              <th className="px-4 py-2 font-medium">Remarks</th>
                              <th className="w-24 px-4 py-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {l.bins.map((b) => {
                              const binErr = binErrors.get(b.key);
                              const opt = l.binOptions.find((o) => o.bin_id === b.bin_id);
                              const fromDelivery = !!b.source_bin_id && b.bin_id === b.source_bin_id;
                              // A bin already used by another row is not offered again.
                              const binOpts = allBinOpts.filter(
                                (o) => o.value === b.bin_id || !used.has(o.value),
                              );
                              return (
                                <tr key={b.key}>
                                  <td className="px-4 py-2.5">
                                    {fromDelivery ? (
                                      <div>
                                        <div className="flex items-center gap-2 font-medium text-slate-800">
                                          {opt?.bin_label ?? b.source_bin_label ?? '—'}
                                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                            from SD
                                          </span>
                                        </div>
                                        {opt?.bin_code && (
                                          <div className="text-xs text-slate-400">{opt.bin_code}</div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="w-60">
                                        <SearchableSelect
                                          value={b.bin_id}
                                          onChange={(v) => patchBin(l.key, b.key, { bin_id: v })}
                                          options={binOpts}
                                          placeholder={
                                            !l.binsLoaded
                                              ? 'Loading bins…'
                                              : allBinOpts.length === 0
                                                ? 'No bin holds this PN there'
                                                : 'Select bin…'
                                          }
                                          searchPlaceholder="Search bin…"
                                          disabled={!l.binsLoaded || allBinOpts.length === 0}
                                        />
                                        {b.source_bin_label && l.binsLoaded && (
                                          <div className="mt-0.5 text-[11px] text-slate-400">
                                            delivery used {b.source_bin_label}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {binErr && (
                                      <div className="mt-0.5 text-xs text-rose-600">{binErr}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <QtyStepper
                                      value={b.qty_transfer}
                                      max={l.max_qty}
                                      invalid={!!err && total > EPS}
                                      onChange={(v) => patchBin(l.key, b.key, { qty_transfer: v })}
                                      onStep={(d) => stepQty(l.key, b.key, d)}
                                    />
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <input
                                      className="input w-48 text-sm"
                                      placeholder="Optional note…"
                                      maxLength={500}
                                      value={b.remarks}
                                      onChange={(e) => patchBin(l.key, b.key, { remarks: e.target.value })}
                                    />
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    {l.bins.length > 1 && (
                                      <button
                                        type="button"
                                        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                                        onClick={() => removeBin(l.key, b.key)}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div className="border-t border-slate-100 px-4 py-2">
                          <button
                            type="button"
                            className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                            onClick={() => addBin(l.key)}
                            disabled={!canAddBin}
                            title={canAddBin ? undefined : 'No other bin holds this PN at the To Location'}
                          >
                            + Add Bin
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sticky summary + actions */}
      <div className="sticky bottom-3 z-10">
        <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <span>
              Selected PN:{' '}
              <b className="text-slate-800">
                {selectedLines.length} / {lines.length}
              </b>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Bins Filled: <b className="text-slate-800">{filledCount}</b>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Total Qty Return: <b className="text-brand-700">{fmt(totalQty)}</b>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {blockingMessage && (
              <span className="hidden text-xs text-amber-600 lg:inline">{blockingMessage}</span>
            )}
            <Link to="/admin/inventory/sales-delivery?type=return" className="btn-secondary">
              Cancel
            </Link>
            <button
              className="btn-primary"
              onClick={() => setConfirming(true)}
              disabled={!canSave}
              title={blockingMessage || undefined}
            >
              Submit Sales Return
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={confirming}
        title="Submit this sales return?"
        onClose={() => (saving ? null : setConfirming(false))}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Row
              label="SR Number"
              value={manualNumber ? trimmedNumber : <span className="text-slate-400">Generated by System</span>}
            />
            <Row label="Reverses" value={source?.delivery_number ?? '—'} />
            <Row label="From Location (billing)" value={billingName} />
            <Row label="To Location" value={toName} />
            <Row label="Customer" value={customerName} />
            <Row label="PN" value={selectedLines.length} />
            <Row label="Total Qty Return" value={fmt(totalQty)} />
            <Row label="Memo" value={memo.trim() || '—'} />
          </dl>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Bin</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedLines.flatMap((l) =>
                  filledBins(l).map((b) => (
                    <tr key={b.key}>
                      <td className="px-3 py-2 font-medium text-slate-700">{l.material_code}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {l.binOptions.find((o) => o.bin_id === b.bin_id)?.bin_label ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {b.qty_transfer}
                        {l.uom_code ? (
                          <span className="ml-1 font-normal text-slate-400">{l.uom_code}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{b.remarks.trim()}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Qty is checked against <b>{billingName}</b>. Once confirmed the return is
            recorded and <b>can no longer be edited or deleted</b>; stock is not changed by
            this submission.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={() => setConfirming(false)} disabled={saving}>
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
