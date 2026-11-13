import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  CreateToFormData,
  CreateToFormOptions,
  CreateToOption,
  CreateToResult,
  CreateToStockItem,
  Paginated,
} from '../../types';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import SearchableSelect from '../../components/SearchableSelect';
import { GridPager } from '../sales-delivery/formParts';
import QuickAddModal, { type QuickAddRow } from './QuickAddModal';
import { Lucide, icons } from '../../components/master/MasterKit';

const CARD = 'rounded-xl bg-white shadow-md dark:bg-slate-800';
const EPS = 1e-9;
/** Oracle's memo field holds up to 999 characters (as the API checks). */
const TEXT_MAX = 999;
const DESCRIPTION_MAX = 300;
const MAX_LINES = 200;
/** Wait this long after the last keystroke before searching. */
const SEARCH_DELAY_MS = 350;
/** Material cards per page, as in Create Inventory Sales. */
const PAGE_SIZES = [9, 18, 27];
const TEXTAREA =
  'min-h-[72px] w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-[#5166AE] focus:ring-2 focus:ring-[#5166AE]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

/**
 * One requested line: the material as listed, plus what the user typed. The
 * same material may be on several lines — each is sent as its own TO line.
 */
interface Line {
  key: number;
  item: CreateToStockItem;
  quantity: string;
  description: string;
}

let nextLineKey = 1;
const newLine = (item: CreateToStockItem, patch: Partial<Omit<Line, 'key' | 'item'>> = {}): Line => ({
  key: nextLineKey++,
  item,
  quantity: '',
  description: '',
  ...patch,
});

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

function errMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const m = err.response?.data?.message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  return fallback;
}

const optionLabel = (o: CreateToOption) => o.name ?? o.oracleId;

/**
 * What is wrong with a line's qty, or null. `total` is the qty of every line
 * of its material: together they may not exceed what is available.
 */
function qtyProblem(line: Line, total: number): string | null {
  const q = Number(line.quantity);
  if (line.quantity.trim() === '' || !Number.isFinite(q) || q <= 0) return 'Enter a qty above 0';
  if (!line.item.allows_decimal && !Number.isInteger(q)) return 'Whole numbers only';
  return isOver(line, total) ? 'Over the available stock' : null;
}

/** Do the material's rows together ask for more than it has available? */
const isOver = (line: Line, total: number) => total > line.item.qty_available + EPS;

/** The most this row can ask for, given what the material's other rows ask. */
function roomFor(line: Line, total: number) {
  const others = total - (Number(line.quantity) || 0);
  const room = Math.max(0, line.item.qty_available - others);
  return line.item.allows_decimal ? room : Math.floor(room + EPS);
}

/**
 * Create Transfer Order, opened from TO Out or TO In: pick the sending
 * warehouse, then the materials it has available, with a qty and description
 * each. The receiving warehouse is one of the user's own. Save Draft keeps it
 * in WMS (still editable); Submit sends it to Oracle for approval.
 *
 * The same form edits a Draft (route `:id/edit`) and clones a Rejected TO
 * (`?clone=<id>`: a new TO with the same content).
 */
export default function TransferOrderCreatePage({ backPath }: { backPath: string }) {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const [searchParams] = useSearchParams();
  const cloneId = editId ? null : searchParams.get('clone');
  const sourceId = editId ?? cloneId;
  const [source, setSource] = useState<CreateToFormData | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const [options, setOptions] = useState<CreateToFormOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [classId, setClassId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [memo, setMemo] = useState('');
  const [noteApproval, setNoteApproval] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState<'draft' | 'submit' | 'delete' | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  // The sending warehouse's stock, one page at a time.
  const [stock, setStock] = useState<Paginated<CreateToStockItem> | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opts, data] = await Promise.all([
          api.get<CreateToFormOptions>('/transfer-orders/create/form-options').then((r) => r.data),
          sourceId
            ? api
                .get<CreateToFormData>(`/transfer-orders/${sourceId}/form-data`, {
                  params: { purpose: editId ? 'edit' : 'clone' },
                })
                .then((r) => r.data)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setOptions(opts);
        const has = (list: CreateToOption[], v: string | null | undefined) => !!v && list.some((o) => o.id === v);
        const pick = (list: CreateToOption[], v: string | null | undefined, fallback: string | null) =>
          has(list, v) ? v! : (fallback ?? '');
        if (!data) {
          setClassId(opts.default_class_id ?? '');
          setDepartmentId(opts.default_department_id ?? '');
          setToId(opts.default_to_warehouse_id ?? '');
          return;
        }
        setSource(data);
        setClassId(pick(opts.classes, data.class_id, opts.default_class_id));
        setDepartmentId(pick(opts.departments, data.department_id, opts.default_department_id));
        setToId(pick(opts.to_warehouses, data.to_warehouse_id, opts.default_to_warehouse_id));
        setMemo(data.memo);
        setNoteApproval(data.note_approval);
        // The lines belong to the sending warehouse: kept only when it can still send.
        const fromOk = has(opts.from_warehouses, data.from_warehouse_id);
        if (fromOk) {
          setFromId(data.from_warehouse_id!);
          setLines(
            data.items.map((r) => newLine(r.item, { quantity: String(r.quantity), description: r.description })),
          );
        } else {
          toast.error('The original sending warehouse can no longer send a Transfer Order — pick one and add the items again.');
        }
        if (data.skipped.length) {
          toast.error(`Left out (material unknown to WMS): ${data.skipped.join(', ')}`);
        }
        if (!has(opts.to_warehouses, data.to_warehouse_id)) {
          toast.error('The original receiving warehouse is not one you can pick — check the Receiving Warehouse.');
        }
      } catch (err) {
        if (!cancelled) setOptionsError(errMessage(err, 'Failed to load the form.'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, editId]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    if (!fromId) {
      setStock(null);
      return;
    }
    let cancelled = false;
    setStockLoading(true);
    api
      .get<Paginated<CreateToStockItem>>('/transfer-orders/create/items', {
        params: { warehouse_id: fromId, page, limit: pageSize, search: search || undefined },
      })
      .then((r) => {
        if (cancelled) return;
        setStock(r.data);
        setStockError('');
      })
      .catch((err) => !cancelled && setStockError(errMessage(err, 'Failed to load the stock.')))
      .finally(() => !cancelled && setStockLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fromId, page, pageSize, search]);

  // Neither side may offer the warehouse picked on the other.
  const fromOptions = useMemo(
    () =>
      (options?.from_warehouses ?? [])
        .filter((w) => w.id !== toId)
        .map((w) => ({ value: w.id, label: optionLabel(w) })),
    [options, toId],
  );
  const toOptions = useMemo(
    () =>
      (options?.to_warehouses ?? [])
        .filter((w) => w.id !== fromId)
        .map((w) => ({ value: w.id, label: optionLabel(w) })),
    [options, fromId],
  );

  const selected = lines;
  // Qty asked per material, over all its lines.
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.item.material_id, (m.get(l.item.material_id) ?? 0) + (Number(l.quantity) || 0));
    return m;
  }, [lines]);
  // The ticked materials (chips), with how many rows each has.
  const pickedMaterials = useMemo(() => {
    const m = new Map<string, { item: CreateToStockItem; rows: number }>();
    for (const l of lines) {
      const cur = m.get(l.item.material_id);
      m.set(l.item.material_id, { item: l.item, rows: (cur?.rows ?? 0) + 1 });
    }
    return [...m.values()];
  }, [lines]);
  const totalOf = (l: Line) => totals.get(l.item.material_id) ?? 0;
  const rowsOf = (l: Line) => pickedMaterials.find((p) => p.item.material_id === l.item.material_id)?.rows ?? 1;
  // Materials whose rows together ask for more than is available.
  const overMaterials = useMemo(
    () =>
      pickedMaterials
        .map((p) => ({ ...p, total: totals.get(p.item.material_id) ?? 0 }))
        .filter((p) => p.total > p.item.qty_available + EPS),
    [pickedMaterials, totals],
  );
  const lineProblems = selected.filter((l) => qtyProblem(l, totalOf(l))).length;

  async function changeFrom(id: string) {
    if (id === fromId) return;
    if (lines.length > 0) {
      const ok = await confirm({
        title: 'Change the sending warehouse?',
        description: 'The items come from the sending warehouse, so every selected item is cleared.',
        confirmText: 'Change warehouse',
      });
      if (!ok) return;
    }
    setLines([]);
    setFromId(id);
    setPage(1);
    setSearchText('');
    setSearch('');
  }

  const full = () => {
    toast.error(`At most ${MAX_LINES} rows per Transfer Order.`);
  };

  /** A material card's tick: adds a row of it, or removes all its rows. */
  function toggle(item: CreateToStockItem) {
    setLines((prev) => {
      if (prev.some((l) => l.item.material_id === item.material_id)) {
        return prev.filter((l) => l.item.material_id !== item.material_id);
      }
      if (prev.length >= MAX_LINES) {
        full();
        return prev;
      }
      return [...prev, newLine(item)];
    });
  }

  /** Quick Add: every checked pasted row becomes its own line, in pasted order. */
  function addPasted(rows: QuickAddRow[]) {
    setLines((prev) => [
      ...prev,
      ...rows.map((r) => newLine(r.item, { quantity: String(r.quantity), description: r.description })),
    ]);
    toast.success(`${rows.length} row(s) added from Quick Add`);
  }

  function editLine(key: number, patch: Partial<Omit<Line, 'key' | 'item'>>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** "+": another row of the same material, right after this one. */
  function addRowAfter(key: number) {
    setLines((prev) => {
      if (prev.length >= MAX_LINES) {
        full();
        return prev;
      }
      const i = prev.findIndex((l) => l.key === key);
      return [...prev.slice(0, i + 1), newLine(prev[i].item), ...prev.slice(i + 1)];
    });
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  /** Delete all: empties Selected Items (and unticks every material card). */
  async function removeAll() {
    const ok = await confirm({
      title: `Delete all ${lines.length} row(s)?`,
      description: 'Every row in Selected Items is removed, with its qty and description. The form header stays as it is.',
      type: 'danger',
      confirmText: 'Delete all',
    });
    if (ok) setLines([]);
  }

  const missing = [
    !fromId && 'Sending Warehouse',
    !toId && 'Receiving Warehouse',
    !classId && 'Class',
    !departmentId && 'Department',
  ].filter(Boolean) as string[];

  /** Save Draft (stays in WMS, still editable) or Submit (sent to Oracle for approval). */
  async function save(mode: 'draft' | 'submit') {
    setTriedSubmit(true);
    if (missing.length) {
      toast.error(`Fill in: ${missing.join(', ')}`);
      return;
    }
    if (selected.length === 0) {
      toast.error('Select at least one item.');
      return;
    }
    if (lineProblems > 0) {
      toast.error('Check the Qty Request of the highlighted items.');
      return;
    }
    const fromName = options?.from_warehouses.find((w) => w.id === fromId)?.name ?? '-';
    const toName = options?.to_warehouses.find((w) => w.id === toId)?.name ?? '-';
    const what = `${selected.length} row(s) from ${fromName} to ${toName}.`;
    const ok = await confirm(
      mode === 'draft'
        ? {
            title: 'Save as Draft?',
            description: `${what} It stays in WMS as a Draft: you can still edit it, then Submit it to Oracle for approval.`,
            confirmText: 'Save Draft',
          }
        : {
            title: 'Submit this Transfer Order?',
            description: `${what} It is sent to Oracle for approval and can no longer be edited; its status shows Syncing until Oracle answers.`,
            confirmText: 'Submit',
          },
    );
    if (!ok) return;

    setSaving(mode);
    try {
      const body = {
        memo: memo.trim(),
        note_approval: noteApproval.trim() || undefined,
        class_id: classId,
        department_id: departmentId,
        from_warehouse_id: fromId,
        to_warehouse_id: toId,
        items: selected.map((l) => ({
          material_id: l.item.material_id,
          quantity: Number(l.quantity),
          description: l.description.trim() || undefined,
        })),
        draft: mode === 'draft',
      };
      const r = editId
        ? await api.put<CreateToResult>(`/transfer-orders/${editId}`, body)
        : await api.post<CreateToResult>('/transfer-orders', body);
      toast.success(
        mode === 'draft'
          ? 'Transfer Order saved as Draft.'
          : 'Transfer Order submitted. It is being sent to Oracle (Syncing).',
      );
      // Its detail follows the sync; the lists may filter it out.
      navigate(`/admin/outbound/transfer-stock/list/${r.data.id}`);
    } catch (err) {
      toast.error(errMessage(err, mode === 'draft' ? 'Save Draft failed' : 'Submit Transfer Order failed'));
    } finally {
      setSaving(null);
    }
  }

  /** Edit form only: delete the Draft (it never reached Oracle). */
  async function deleteDraft() {
    const ok = await confirm({
      title: 'Delete this Draft?',
      description: 'The Draft and its items are removed. It was never sent to Oracle. This cannot be undone.',
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    setSaving('delete');
    try {
      await api.delete(`/transfer-orders/${editId}`);
      toast.success('Draft deleted.');
      navigate(backPath);
    } catch (err) {
      toast.error(errMessage(err, 'Delete failed'));
      setSaving(null);
    }
  }

  if (optionsError) {
    return <div className={`${CARD} p-8 text-center text-sm text-red-600`}>{optionsError}</div>;
  }
  if (!options) {
    return <div className={`${CARD} p-8 text-center text-sm text-neutral-500`}>Loading…</div>;
  }

  const rows = stock?.rows ?? [];
  const invalid = (empty: boolean) => (triedSubmit && empty ? 'rounded-lg ring-2 ring-red-300' : '');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`${CARD} space-y-5 p-5`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(backPath)}
            aria-label="Back"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Lucide>{icons.chevronLeft}</Lucide>
          </button>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">
            {editId ? 'Edit Transfer Order' : cloneId ? 'Clone Transfer Order' : 'Create Transfer Order'}
          </h1>
          {editId && source?.outbound_id && (
            <span className="rounded-full border border-slate-400 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
              {source.outbound_id} · Draft
            </span>
          )}
        </div>

        <div className="rounded-r-lg border-l-4 border-[#5166AE] bg-[#F2F4FD] px-4 py-3 text-sm text-[#41528c]">
          {cloneId && source && (
            <p className="mb-1 font-medium">
              Copied from the Rejected {source.tran_id ?? source.outbound_id ?? 'Transfer Order'}. Check it, then save it
              as a new Transfer Order.
            </p>
          )}
          Pick the sending warehouse to see the materials it has available. <b>Save Draft</b> keeps it in WMS (still
          editable); <b>Submit</b> sends it to Oracle for approval.
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Sending Warehouse" required>
            <div className={invalid(!fromId)}>
              <SearchableSelect
                value={fromId}
                onChange={changeFrom}
                placeholder="Select sending warehouse..."
                searchPlaceholder="Search warehouse…"
                options={fromOptions}
              />
            </div>
          </Field>
          <Field label="Receiving Warehouse" required>
            <div className={invalid(!toId)}>
              <SearchableSelect
                value={toId}
                onChange={setToId}
                placeholder="Select receiving warehouse..."
                searchPlaceholder="Search warehouse…"
                options={toOptions}
                emptyText="None of your warehouses"
              />
            </div>
          </Field>
          <Field label="Class" required>
            <div className={invalid(!classId)}>
              <SearchableSelect
                value={classId}
                onChange={setClassId}
                placeholder="Select class..."
                searchPlaceholder="Search class…"
                options={options.classes.map((c) => ({ value: c.id, label: optionLabel(c) }))}
              />
            </div>
          </Field>
          <Field label="Department" required>
            <div className={invalid(!departmentId)}>
              <SearchableSelect
                value={departmentId}
                onChange={setDepartmentId}
                placeholder="Select department..."
                searchPlaceholder="Search department…"
                options={options.departments.map((d) => ({ value: d.id, label: optionLabel(d) }))}
              />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TextArea
            label="Memo"
            value={memo}
            onChange={setMemo}
            placeholder="e.g. Weekly stock request"
          />
          <TextArea
            label="Note Approval"
            value={noteApproval}
            onChange={setNoteApproval}
            placeholder="Note for the approver..."
          />
        </div>
      </div>

      {/* Stock of the sending warehouse — picked as in Create Inventory Sales (SD). */}
      <div className={CARD}>
        <SectionHead
          title="Select Items"
          subtitle={`Tick the materials to transfer from the sending warehouse; set their qty and description in Selected Items (max ${MAX_LINES} rows).`}
          right={
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <span className="rounded-full bg-[#5166AE]/10 px-3 py-1 text-xs font-semibold text-[#5166AE]">
                  {pickedMaterials.length} material(s) · {selected.length} row(s)
                </span>
              )}
              {fromId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickAddOpen(true)}
                  title="Paste PN and qty from Excel or a list"
                >
                  <Lucide>{icons.plus}</Lucide>
                  Quick Add
                </button>
              )}
            </div>
          }
        />
        {!fromId ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            Select a Sending Warehouse first to see its items.
          </p>
        ) : (
          <div className="space-y-4 p-5">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400">
                <Lucide>{icons.search}</Lucide>
              </span>
              <input
                className="input pl-10"
                placeholder="Search material by code or name..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                aria-label="Search material"
              />
            </div>

            {pickedMaterials.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pickedMaterials.map(({ item, rows: n }) => (
                  <span
                    key={item.material_id}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs text-brand-700"
                  >
                    <b className="font-semibold">{item.material_code}</b>
                    {item.material_name && <span className="text-brand-600/80">({item.material_name})</span>}
                    {n > 1 && <span className="font-medium">×{n}</span>}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full px-1 text-brand-500 hover:bg-brand-100 hover:text-brand-700"
                      onClick={() => toggle(item)}
                      aria-label={`Remove ${item.material_code}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {stockError ? (
              <p className="py-6 text-center text-sm text-red-600">{stockError}</p>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                {stockLoading
                  ? 'Loading materials…'
                  : search
                    ? 'No material matches the search.'
                    : 'This warehouse has no available stock to transfer.'}
              </p>
            ) : (
              <>
                <div
                  className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${stockLoading ? 'opacity-60' : ''}`}
                >
                  {rows.map((item) => {
                    const checked = lines.some((l) => l.item.material_id === item.material_id);
                    const disabled = !checked && selected.length >= MAX_LINES;
                    return (
                      <label
                        key={item.material_id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                          checked
                            ? 'border-brand-400 bg-brand-50/40 ring-1 ring-brand-200'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        title={disabled ? `At most ${MAX_LINES} rows` : undefined}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(item)}
                          aria-label={`Select ${item.material_code}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-800">{item.material_code}</div>
                          <div className="truncate text-xs text-slate-500" title={item.material_name ?? ''}>
                            {item.material_name ?? '—'}
                          </div>
                        </div>
                        <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {fmt(item.qty_available)} available
                        </span>
                      </label>
                    );
                  })}
                </div>
                <GridPager
                  pageSize={pageSize}
                  pageSizes={PAGE_SIZES}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  start={(page - 1) * pageSize}
                  shown={rows.length}
                  total={stock?.total_data ?? 0}
                  page={page}
                  pageCount={Math.max(1, stock?.total_page ?? 1)}
                  onPage={setPage}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* What will be sent */}
      {selected.length > 0 && (
        <div className={CARD}>
          <SectionHead
            title={`Selected Items (${selected.length})`}
            subtitle="The lines of the Transfer Order, across every page and search. “+” adds another row of the same material; each row is its own line."
            right={
              <button
                type="button"
                onClick={removeAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-transparent"
              >
                <Lucide>{icons.trash}</Lucide>
                Delete all
              </button>
            }
          />
          {overMaterials.length > 0 && (
            <div
              role="alert"
              className="mx-5 mt-4 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
            >
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
              </svg>
              <div className="min-w-0 space-y-1">
                <p className="font-semibold">Qty Request exceeds the available stock</p>
                <ul className="space-y-0.5 text-rose-700 dark:text-rose-300">
                  {overMaterials.map((m) => (
                    <li key={m.item.material_id}>
                      <b>{m.item.material_code}</b>
                      {m.item.material_name && <span className="text-rose-600/80"> · {m.item.material_name}</span>} —{' '}
                      {m.rows > 1 ? `${m.rows} rows request ` : 'requested '}
                      <b>{fmt(m.total)}</b>, available <b>{fmt(m.item.qty_available)}</b>{' '}
                      <span className="whitespace-nowrap rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold dark:bg-rose-900/40">
                        over by {fmt(m.total - m.item.qty_available)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-rose-600/90 dark:text-rose-300/80">
                  Lower the highlighted rows (or use “Use max” on one of them) — rows of the same material share its stock.
                </p>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-slate-900/40">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                  <th className="w-12">No</th>
                  <th>Part Number</th>
                  <th>Material Name</th>
                  <th className="text-right">Available</th>
                  <th className="w-36">Qty Request</th>
                  <th className="w-64">Description</th>
                  <th className="w-24" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-slate-700">
                {selected.map((line, i) => {
                  const problem = qtyProblem(line, totalOf(line));
                  const over = isOver(line, totalOf(line));
                  const rowCount = rowsOf(line);
                  return (
                    <tr key={line.key} className={over ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}>
                      <td className="px-4 py-2 text-neutral-500">{i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-medium">{line.item.material_code}</td>
                      <td className="px-4 py-2">{line.item.material_name ?? '-'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {fmt(line.item.qty_available)}
                        {rowCount > 1 && (
                          <div className="text-[11px] font-normal text-neutral-400">shared by {rowCount} rows</div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <QtyInput
                          line={line}
                          total={totalOf(line)}
                          rowCount={rowCount}
                          problem={triedSubmit ? problem : null}
                          onChange={(quantity) => editLine(line.key, { quantity })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          value={line.description}
                          maxLength={DESCRIPTION_MAX}
                          onChange={(e) => editLine(line.key, { description: e.target.value })}
                          placeholder="Optional"
                          aria-label={`Description for ${line.item.material_code}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => addRowAfter(line.key)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-[#F2F4FD] hover:text-[#5166AE]"
                          aria-label={`Add another row of ${line.item.material_code}`}
                          title="Add another row of this material"
                        >
                          <Lucide>{icons.plus}</Lucide>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove row ${i + 1} (${line.item.material_code})`}
                        >
                          <Lucide>{icons.trash}</Lucide>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <QuickAddModal
        open={quickAddOpen}
        warehouseId={fromId}
        warehouseName={options.from_warehouses.find((w) => w.id === fromId)?.name ?? 'the sending warehouse'}
        existing={totals}
        roomLeft={MAX_LINES - selected.length}
        onAdd={addPasted}
        onClose={() => setQuickAddOpen(false)}
      />

      <div className="flex flex-wrap justify-end gap-2">
        {editId && (
          <button
            type="button"
            onClick={deleteDraft}
            disabled={!!saving}
            className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:bg-transparent"
          >
            <Lucide>{icons.trash}</Lucide>
            {saving === 'delete' ? 'Deleting…' : 'Delete Draft'}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate(backPath)}
          disabled={!!saving}
        >
          Cancel
        </button>
        <button type="button" className="btn-secondary" onClick={() => save('draft')} disabled={!!saving}>
          {saving === 'draft' ? 'Saving…' : 'Save Draft'}
        </button>
        <button type="button" className="btn-primary" onClick={() => save('submit')} disabled={!!saving}>
          {saving === 'submit' ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

function QtyInput({
  line,
  total,
  rowCount,
  problem,
  onChange,
}: {
  line: Line;
  /** Qty of every row of this material. */
  total: number;
  /** How many rows the material has. */
  rowCount: number;
  problem: string | null;
  onChange: (value: string) => void;
}) {
  // Over the available stock (all rows together) is flagged as it is typed, the rest on submit.
  const over = line.quantity !== '' && isOver(line, total);
  const room = roomFor(line, total);
  const left = line.item.qty_available - total;
  return (
    <div>
      <input
        type="number"
        min={0}
        step={line.item.allows_decimal ? 'any' : 1}
        max={line.item.qty_available}
        className={`input text-right ${over || problem ? 'border-red-400 bg-white focus:border-red-500 focus:ring-red-200' : ''}`}
        value={line.quantity}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        aria-label={`Qty request for ${line.item.material_code}`}
        aria-invalid={over || !!problem}
      />
      {over ? (
        <div className="mt-1 space-y-0.5 text-xs">
          <p className="font-medium text-red-600">Over by {fmt(total - line.item.qty_available)}</p>
          {room > 0 ? (
            <button
              type="button"
              className="font-medium text-[#5166AE] underline-offset-2 hover:underline"
              onClick={() => onChange(String(room))}
            >
              Use max {fmt(room)}
            </button>
          ) : (
            <p className="text-red-500/90">Other rows already use all {fmt(line.item.qty_available)}</p>
          )}
        </div>
      ) : problem ? (
        <p className="mt-1 text-xs font-medium text-red-600">{problem}</p>
      ) : rowCount > 1 && line.quantity !== '' ? (
        <p className="mt-1 text-xs text-neutral-400">{fmt(left)} left for this material</p>
      ) : null}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-neutral-800 dark:text-slate-200">
        {label} {required && <span className="text-red-500">*</span>}
      </div>
      {children}
    </div>
  );
}

function TextArea({
  label,
  required,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-neutral-800 dark:text-slate-200">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
        <span className="text-xs text-neutral-500">
          {value.length}/{TEXT_MAX}
        </span>
      </div>
      <textarea
        className={`${TEXTAREA} ${invalid ? 'border-red-400' : ''}`}
        value={value}
        maxLength={TEXT_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function SectionHead({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-t-xl border-b border-neutral-200 bg-neutral-50/60 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/30">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{title}</h2>
        <p className="mt-0.5 text-[13px] text-neutral-600 dark:text-slate-400">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}
