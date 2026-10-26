import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useFormDraft } from '../../hooks/useFormDraft';
import DraftBanner from './DraftBanner';
import {
  DocNumberField,
  EmptyState,
  FieldLabel,
  GridPager,
  QtyStepper,
  Row,
  SectionHead,
} from './formParts';

/**
 * Create a Sales Delivery.
 *
 * The journey mirrors the production WMS: fill the header, tick materials from
 * the From Location's stock (cards), then tick the bins of each material and
 * type how much leaves each one. A sticky footer keeps the running totals in
 * view, and Submit opens a preview before anything is recorded.
 */

/** One bin the material can be taken from; ticked bins become document lines. */
interface BinRow {
  bin_id: string;
  bin_label: string | null;
  bin_code: string | null;
  avail: number;
  selected: boolean;
  qty_transfer: number;
  /** Free note for this line; optional, stored with the item. */
  remarks: string;
}

interface Group {
  material_id: string;
  material_code: string | null;
  material_name: string | null;
  uom_code: string | null;
  allows_decimal: boolean;
  binsLoaded: boolean;
  expanded: boolean;
  bins: BinRow[];
}

const EPS = 1e-9;
/** The most materials one document can carry. */
const MAX_MATERIALS = 50;
const PAGE_SIZES = [9, 18, 27];
const MEMO_MAX = 300;

const fmt = (n: number) => n.toLocaleString();

/** What is kept between visits until the delivery is submitted. */
interface SdDraft {
  manualNumber: boolean;
  sdNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  customerId: string;
  departmentId: string;
  classId: string;
  memo: string;
  groups: Group[];
}

export default function SalesDeliveryCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWarehouseId } = useWarehouse();

  const [options, setOptions] = useState<SalesDeliveryFormOptions | null>(null);
  const [manualNumber, setManualNumber] = useState(false);
  const [sdNumber, setSdNumber] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [classId, setClassId] = useState('');
  const [memo, setMemo] = useState('');

  const [materials, setMaterials] = useState<SdMaterialOption[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialPage, setMaterialPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Unsaved input survives a refresh or a failed submit: read once here,
  // applied when the header options arrive, written back on every change.
  const draftStore = useFormDraft<SdDraft>('sales-delivery');
  const [initialDraft] = useState(() => draftStore.load());
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  /** The active warehouse the draft was restored under (null = not restored). */
  const draftAppliedFor = useRef<string | null | undefined>(undefined);
  /** Lines to put back once the restored From Location's materials load. */
  const pendingGroups = useRef<Group[] | null>(null);
  const [draftReady, setDraftReady] = useState(false);

  // Header options. Re-read when the active warehouse changes, since From
  // Location defaults to it.
  useEffect(() => {
    api
      .get<SalesDeliveryFormOptions>('/sales-delivery/form-options')
      .then((r) => {
        setOptions(r.data);
        const restored = draftAppliedFor.current !== undefined;
        const d = !restored ? initialDraft?.data : undefined;
        if (d && initialDraft) {
          draftAppliedFor.current = activeWarehouseId ?? null;
          setManualNumber(d.manualNumber);
          setSdNumber(d.sdNumber);
          setToWarehouseId(d.toWarehouseId);
          setCustomerId(d.customerId);
          setDepartmentId(d.departmentId);
          setClassId(d.classId);
          setMemo(d.memo);
          pendingGroups.current = d.groups ?? [];
          setFromWarehouseId(d.fromWarehouseId);
          setRestoredAt(initialDraft.savedAt);
        } else if (restored && draftAppliedFor.current === (activeWarehouseId ?? null)) {
          // Same load again (React re-runs effects in development): keep the
          // restored header instead of resetting it to the defaults.
        } else {
          setFromWarehouseId(r.data.default_from_warehouse_id ?? '');
          setToWarehouseId((prev) =>
            prev === r.data.default_from_warehouse_id ? '' : prev,
          );
          // Department defaults to the creator's own, still overridable.
          setDepartmentId((prev) => prev || r.data.default_department_id || '');
        }
        setDraftReady(true);
      })
      .catch(() => setOptions(null));
    // initialDraft never changes; it is read once on mount.
  }, [activeWarehouseId, initialDraft]);

  // Materials and bins belong to the From warehouse: a new From clears every line.
  useEffect(() => {
    // A restored draft brings its lines back instead of starting empty.
    setGroups(pendingGroups.current ?? []);
    pendingGroups.current = null;
    setMaterialSearch('');
    setMaterialPage(1);
    if (!fromWarehouseId) {
      setMaterials([]);
      return;
    }
    let active = true;
    setMaterialsLoading(true);
    api
      .get<SdMaterialOption[]>('/sales-delivery/materials', {
        params: { from_warehouse_id: fromWarehouseId },
      })
      .then((r) => active && setMaterials(r.data))
      .catch(() => active && setMaterials([]))
      .finally(() => active && setMaterialsLoading(false));
    // Ignore a slower response for a From that was already replaced.
    return () => {
      active = false;
    };
  }, [fromWarehouseId]);

  // Keep the draft in step with the form. An untouched form stores nothing.
  useEffect(() => {
    if (!draftReady) return;
    const touched =
      groups.length > 0 ||
      memo.trim() !== '' ||
      sdNumber.trim() !== '' ||
      toWarehouseId !== '' ||
      customerId !== '' ||
      classId !== '';
    if (!touched) {
      draftStore.clear();
      return;
    }
    draftStore.save({
      manualNumber,
      sdNumber,
      fromWarehouseId,
      toWarehouseId,
      customerId,
      departmentId,
      classId,
      memo,
      // Lines whose bins were still loading would come back stuck.
      groups: groups.filter((g) => g.binsLoaded),
    });
  }, [
    draftReady,
    draftStore,
    manualNumber,
    sdNumber,
    fromWarehouseId,
    toWarehouseId,
    customerId,
    departmentId,
    classId,
    memo,
    groups,
  ]);

  function discardDraft() {
    draftStore.clear();
    window.location.reload();
  }

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

  // ----- material cards -----

  const selectedIds = new Set(groups.map((g) => g.material_id));
  const atMaterialCap = groups.length >= MAX_MATERIALS;

  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    const list = materials.filter((m) => m.material_id);
    if (!q) return list;
    return list.filter(
      (m) =>
        (m.material_code ?? '').toLowerCase().includes(q) ||
        (m.material_name ?? '').toLowerCase().includes(q),
    );
  }, [materials, materialSearch]);

  const pageCount = Math.max(1, Math.ceil(filteredMaterials.length / pageSize));
  const currentPage = Math.min(materialPage, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageMaterials = filteredMaterials.slice(pageStart, pageStart + pageSize);

  function toggleMaterial(m: SdMaterialOption) {
    const id = m.material_id;
    if (!id) return;
    if (selectedIds.has(id)) {
      setGroups((gs) => gs.filter((g) => g.material_id !== id));
      return;
    }
    if (atMaterialCap) return;
    addMaterial(m);
  }

  async function addMaterial(m: SdMaterialOption) {
    const materialId = m.material_id as string;
    setGroups((gs) => [
      ...gs,
      {
        material_id: materialId,
        material_code: m.material_code,
        material_name: m.material_name,
        uom_code: m.uom_code ?? null,
        allows_decimal: m.allows_decimal ?? true,
        binsLoaded: false,
        expanded: true,
        bins: [],
      },
    ]);
    try {
      const r = await api.get<SdBinOption[]>('/sales-delivery/bins', {
        params: { material_id: materialId, from_warehouse_id: fromWarehouseId },
      });
      const bins: BinRow[] = r.data
        .filter((b) => b.bin_id)
        .map((b) => ({
          bin_id: b.bin_id as string,
          bin_label: b.bin_label,
          bin_code: b.bin_code ?? null,
          avail: b.qty_available,
          selected: false,
          qty_transfer: 0,
          remarks: '',
        }));
      setGroups((gs) =>
        gs.map((g) => (g.material_id === materialId ? { ...g, bins, binsLoaded: true } : g)),
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

  // ----- bins -----

  function patchGroup(materialId: string, patch: (g: Group) => Partial<Group>) {
    setGroups((gs) =>
      gs.map((g) => (g.material_id === materialId ? { ...g, ...patch(g) } : g)),
    );
  }

  function patchBin(materialId: string, binId: string, patch: Partial<BinRow>) {
    patchGroup(materialId, (g) => ({
      bins: g.bins.map((b) => (b.bin_id === binId ? { ...b, ...patch } : b)),
    }));
  }

  /** The header checkbox ticks every bin of the material, or clears them all. */
  function toggleAllBins(materialId: string, select: boolean) {
    patchGroup(materialId, (g) => ({
      bins: g.bins.map((b) => ({ ...b, selected: select })),
    }));
  }

  /** −/+ on the stepper, clamped to 0..available. Reads the latest qty so quick clicks add up. */
  function stepQty(materialId: string, binId: string, delta: number) {
    patchGroup(materialId, (g) => ({
      bins: g.bins.map((b) =>
        b.bin_id === binId
          ? {
              ...b,
              qty_transfer: Math.max(
                0,
                Math.min(b.avail, (Number(b.qty_transfer) || 0) + delta),
              ),
            }
          : b,
      ),
    }));
  }

  // One error per ticked bin, so the user sees exactly which row is wrong.
  const binErrors = useMemo(() => {
    const errs = new Map<string, string>();
    for (const g of groups) {
      for (const b of g.bins) {
        if (!b.selected) continue;
        const key = `${g.material_id}|${b.bin_id}`;
        const qty = Number(b.qty_transfer) || 0;
        if (qty < 0) errs.set(key, 'Qty cannot be negative');
        else if (qty <= EPS) errs.set(key, 'Qty is required');
        else if (qty > b.avail + EPS) errs.set(key, `Exceeds available (${fmt(b.avail)})`);
        else if (!g.allows_decimal && Math.abs(qty - Math.round(qty)) > EPS) {
          errs.set(key, 'Whole numbers only');
        }
      }
    }
    return errs;
  }, [groups]);

  const selectedBins = groups.flatMap((g) =>
    g.bins.filter((b) => b.selected).map((b) => ({ g, b })),
  );
  const groupsWithoutBins = groups.filter(
    (g) => g.binsLoaded && !g.bins.some((b) => b.selected),
  );
  const totalQty = selectedBins.reduce((s, { b }) => s + (Number(b.qty_transfer) || 0), 0);

  // ----- submit -----

  const trimmedNumber = sdNumber.trim();
  const blockingMessage = (() => {
    if (manualNumber && !trimmedNumber) return 'Enter the SD Number, or switch back to System Format.';
    if (!fromWarehouseId) return 'Select a From Location.';
    if (!toWarehouseId) return 'Select a To Location.';
    if (!departmentId) return 'Select a department.';
    if (!classId) return 'Select a class.';
    if (groups.length === 0) return 'Select at least one material.';
    if (groupsWithoutBins.length > 0) return 'Every selected material needs at least one bin.';
    if (binErrors.size > 0) return 'Fix the Qty Transfer of the highlighted bins.';
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
  const customerName = (() => {
    const c = options?.customer_options.find((x) => x.id === customerId);
    if (!c) return '—';
    return c.name ?? c.entity_id ?? c.id;
  })();
  const className = (() => {
    const c = options?.class_options.find((x) => x.id === classId);
    return c ? c.name ?? c.oracle_id : '—';
  })();

  // What the memo will look like once stored: "{memo} | {SD number}". A system
  // number only exists after the document is created, so it shows as SD-….
  const numberPreview = manualNumber && trimmedNumber ? trimmedNumber : 'SD-…';
  const memoPreview = memo.trim() ? `${memo.trim()} | ${numberPreview}` : numberPreview;

  async function handleSubmit() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const r = await api.post<{ id: string; delivery_number: string }>(
        '/sales-delivery',
        {
          delivery_number: manualNumber ? trimmedNumber : undefined,
          from_warehouse_id: fromWarehouseId,
          to_warehouse_id: toWarehouseId,
          customer_id: customerId || undefined,
          department_id: departmentId,
          class_id: classId,
          memo: memo.trim() || undefined,
          items: selectedBins.map(({ g, b }) => ({
            material_id: g.material_id,
            bin_id: b.bin_id,
            qty_transfer: Number(b.qty_transfer) || 0,
            remarks: b.remarks.trim() || undefined,
          })),
        },
      );
      draftStore.clear();
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
    <div className="space-y-5 pb-4">
      {restoredAt && <DraftBanner savedAt={restoredAt} onDiscard={discardDraft} />}
      {/* Header */}
      <div className="card p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/admin/inventory/sales-delivery"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Back"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Create Sales Delivery</h1>
        </div>

        <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-3">
          <DocNumberField
            label="SD Number"
            manual={manualNumber}
            value={sdNumber}
            onManualChange={setManualNumber}
            onChange={setSdNumber}
          />
          <div>
            <FieldLabel required>From Location</FieldLabel>
            <SearchableSelect
              value={fromWarehouseId}
              onChange={changeFrom}
              placeholder="Select From Location..."
              searchPlaceholder="Search location…"
              disabled={!options}
              options={fromOptions}
            />
          </div>
          <div>
            <FieldLabel required>To Location</FieldLabel>
            <SearchableSelect
              value={toWarehouseId}
              onChange={setToWarehouseId}
              placeholder="Select To Location..."
              searchPlaceholder="Search location…"
              disabled={!options}
              options={toOptions}
            />
          </div>

          <div>
            <FieldLabel required>Department</FieldLabel>
            <SearchableSelect
              value={departmentId}
              onChange={setDepartmentId}
              placeholder="Select Department..."
              searchPlaceholder="Search department…"
              disabled={!options}
              options={(options?.department_options ?? []).map((d) => ({
                value: d.id,
                label: d.name ?? d.oracle_id,
              }))}
            />
          </div>
          <div>
            <FieldLabel required>Class</FieldLabel>
            <SearchableSelect
              value={classId}
              onChange={setClassId}
              placeholder="Select Class..."
              searchPlaceholder="Search class…"
              disabled={!options}
              options={(options?.class_options ?? []).map((c) => ({
                value: c.id,
                label: c.name ?? c.oracle_id,
              }))}
            />
          </div>
          <div>
            <FieldLabel>Customer</FieldLabel>
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              placeholder="Select Customer..."
              searchPlaceholder="Search customer name or code..."
              disabled={!options}
              options={(options?.customer_options ?? []).map((c) => ({
                value: c.id,
                label: c.entity_id
                  ? `${c.entity_id} — ${c.name ?? ''}`.trim()
                  : (c.name ?? c.id),
              }))}
            />
          </div>

          <div className="md:col-span-3">
            <FieldLabel aside={`${memo.length}/${MEMO_MAX}`}>Memo</FieldLabel>
            <textarea
              className="input min-h-[84px] resize-y"
              value={memo}
              maxLength={MEMO_MAX}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Enter reason or note for this sales delivery (optional)..."
            />
            <p className="mt-1.5 text-xs text-slate-400">
              The SD Number is appended automatically, so Oracle receives "your memo | SD
              Number".
            </p>
          </div>
        </div>
      </div>

      {/* Select Materials */}
      <div className="card overflow-hidden">
        <SectionHead
          title="Select Materials"
          subtitle={`Select items from your warehouse to allocate for sales delivery transfer (max ${MAX_MATERIALS} materials).`}
          badge={
            groups.length > 0 ? `${groups.length} / ${MAX_MATERIALS} Materials Selected` : undefined
          }
        />
        {!fromWarehouseId ? (
          <EmptyState>
            Select a From Location first, the material list is taken from that warehouse.
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
                value={materialSearch}
                onChange={(e) => {
                  setMaterialSearch(e.target.value);
                  setMaterialPage(1);
                }}
                placeholder="Search material by code or name..."
              />
            </div>

            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <span
                    key={g.material_id}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs text-brand-700"
                  >
                    <b className="font-semibold">{g.material_code}</b>
                    {g.material_name && <span className="text-brand-600/80">({g.material_name})</span>}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full px-1 text-brand-500 hover:bg-brand-100 hover:text-brand-700"
                      onClick={() => removeMaterial(g.material_id)}
                      aria-label={`Remove ${g.material_code}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {materialsLoading ? (
              <p className="py-6 text-center text-sm text-slate-400">Loading materials…</p>
            ) : filteredMaterials.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                {materials.length === 0
                  ? 'No material with available stock in this location.'
                  : 'No material matches the search.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pageMaterials.map((m) => {
                    const checked = selectedIds.has(m.material_id as string);
                    const disabled = !checked && atMaterialCap;
                    return (
                      <label
                        key={m.material_id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                          checked
                            ? 'border-brand-400 bg-brand-50/40 ring-1 ring-brand-200'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        title={disabled ? `At most ${MAX_MATERIALS} materials` : undefined}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleMaterial(m)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-800">
                            {m.material_code ?? '—'}
                          </div>
                          <div className="truncate text-xs text-slate-500" title={m.material_name ?? ''}>
                            {m.material_name ?? '—'}
                          </div>
                        </div>
                        {m.qty_available != null && (
                          <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            {fmt(m.qty_available)} available
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                <GridPager
                  pageSize={pageSize}
                  pageSizes={PAGE_SIZES}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setMaterialPage(1);
                  }}
                  start={pageStart}
                  shown={pageMaterials.length}
                  total={filteredMaterials.length}
                  page={currentPage}
                  pageCount={pageCount}
                  onPage={setMaterialPage}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Select Bins — appears once there is a warehouse to take bins from. */}
      {fromWarehouseId && (
        <div className="card overflow-hidden">
          <SectionHead
            title="Select Bins"
            subtitle="Specify the transfer quantity for each bin. Qty Transfer cannot exceed available stock or be empty/negative."
            badge={selectedBins.length > 0 ? `${selectedBins.length} Bins Selected` : undefined}
          />
          {groups.length === 0 ? (
            <EmptyState>Select a Material to choose bins.</EmptyState>
          ) : (
            <div className="space-y-4 p-5">
              {binErrors.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
                  </svg>
                  Please enter a valid Qty Transfer for all selected bins. It cannot exceed
                  available quantity or be zero.
                </div>
              )}

              {groups.map((g) => {
                const picked = g.bins.filter((b) => b.selected).length;
                const allPicked = g.bins.length > 0 && picked === g.bins.length;
                return (
                  <div key={g.material_id} className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="flex items-center gap-3 bg-slate-50 px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                        checked={allPicked}
                        ref={(el) => {
                          if (el) el.indeterminate = picked > 0 && !allPicked;
                        }}
                        disabled={!g.binsLoaded || g.bins.length === 0}
                        onChange={(e) => toggleAllBins(g.material_id, e.target.checked)}
                        aria-label={`Select every bin of ${g.material_code}`}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => patchGroup(g.material_id, (x) => ({ expanded: !x.expanded }))}
                      >
                        <span className="truncate text-sm font-semibold text-slate-800">
                          {g.material_code}
                        </span>
                        {g.material_name && (
                          <span className="truncate text-xs text-slate-500">({g.material_name})</span>
                        )}
                      </button>
                      {picked === 0 && g.binsLoaded && g.bins.length > 0 && (
                        <span className="text-[11px] text-amber-600">choose at least one bin</span>
                      )}
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                        {picked}/{g.bins.length} bin(s)
                      </span>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                        onClick={() => patchGroup(g.material_id, (x) => ({ expanded: !x.expanded }))}
                        aria-expanded={g.expanded}
                        aria-label={g.expanded ? 'Collapse bins' : 'Expand bins'}
                      >
                        <svg
                          className={`h-4 w-4 transition-transform ${g.expanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    {g.expanded &&
                      (!g.binsLoaded ? (
                        <div className="px-4 py-3 text-xs text-slate-400">Loading bins…</div>
                      ) : g.bins.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-400">
                          No bin holds available stock of this material.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-100 text-sm">
                            <thead className="text-left text-xs text-slate-500">
                              <tr>
                                <th className="w-10 px-4 py-2" />
                                <th className="px-4 py-2 font-medium">Bin</th>
                                <th className="px-4 py-2 text-right font-medium">Available QTY</th>
                                <th className="px-4 py-2 font-medium">Qty Transfer</th>
                                <th className="px-4 py-2 font-medium">Remarks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {g.bins.map((b) => {
                                const err = binErrors.get(`${g.material_id}|${b.bin_id}`);
                                return (
                                  <tr key={b.bin_id} className={b.selected ? undefined : 'text-slate-500'}>
                                    <td className="px-4 py-2.5">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                                        checked={b.selected}
                                        onChange={(e) =>
                                          patchBin(g.material_id, b.bin_id, { selected: e.target.checked })
                                        }
                                        aria-label={`Select bin ${b.bin_label ?? b.bin_id}`}
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <div className="font-medium text-slate-800">{b.bin_label ?? '—'}</div>
                                      {b.bin_code && (
                                        <div className="text-xs text-slate-400">{b.bin_code}</div>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                                      {fmt(b.avail)}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <QtyStepper
                                          value={b.qty_transfer}
                                          max={b.avail}
                                          allowsDecimal={g.allows_decimal}
                                          disabled={!b.selected}
                                          invalid={!!err}
                                          onChange={(v) =>
                                            patchBin(g.material_id, b.bin_id, { qty_transfer: v })
                                          }
                                          onStep={(d) => stepQty(g.material_id, b.bin_id, d)}
                                        />
                                      {err && <div className="mt-1 text-xs text-rose-600">{err}</div>}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <input
                                        className="input w-48 text-sm"
                                        placeholder="Optional note…"
                                        maxLength={500}
                                        disabled={!b.selected}
                                        value={b.remarks}
                                        onChange={(e) =>
                                          patchBin(g.material_id, b.bin_id, { remarks: e.target.value })
                                        }
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
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
              Selected Materials:{' '}
              <b className="text-slate-800">
                {groups.length} / {MAX_MATERIALS}
              </b>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Selected Bins: <b className="text-slate-800">{selectedBins.length}</b>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Total Qty Transfer: <b className="text-brand-700">{fmt(totalQty)}</b>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {blockingMessage && (
              <span className="hidden text-xs text-amber-600 lg:inline">{blockingMessage}</span>
            )}
            <Link to="/admin/inventory/sales-delivery" className="btn-secondary">
              Cancel
            </Link>
            <button
              className="btn-primary"
              onClick={() => setConfirming(true)}
              disabled={!canSave}
              title={blockingMessage || undefined}
            >
              Submit Sales Delivery
            </button>
          </div>
        </div>
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
            <Row
              label="SD Number"
              value={manualNumber ? trimmedNumber : <span className="text-slate-400">Generated by System</span>}
            />
            <Row label="From Location" value={fromWarehouseName} />
            <Row label="To Location" value={toWarehouseName} />
            <Row label="Customer" value={customerName} />
            <Row label="Department" value={departmentName} />
            <Row label="Class" value={className} />
            <Row label="Materials" value={groups.length} />
            <Row label="Bin lines" value={selectedBins.length} />
            <Row label="Total Qty Transfer" value={fmt(totalQty)} />
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
                  <th className="px-3 py-2">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedBins.map(({ g, b }) => (
                  <tr key={`${g.material_id}|${b.bin_id}`}>
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {g.material_code}
                      {g.material_name ? (
                        <span className="ml-1 font-normal text-slate-400">{g.material_name}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{b.bin_label ?? b.bin_id}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{fmt(b.avail)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">
                      {b.qty_transfer}
                      {g.uom_code ? (
                        <span className="ml-1 font-normal text-slate-400">{g.uom_code}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{b.remarks.trim()}</td>
                  </tr>
                ))}
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

