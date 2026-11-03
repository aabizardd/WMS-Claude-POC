import { useMemo, useState } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import { downloadFile } from '../../lib/download';
import type { CreateToStockItem, Paginated } from '../../types';
import { DocModal } from '../../components/wms/DocKit';
import SearchableSelect from '../../components/SearchableSelect';
import { Lucide, icons } from '../../components/master/MasterKit';
import { QUICK_ADD_MAX_LINES, parseQuickAdd } from './quickAdd';

const EPS = 1e-9;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

type LookupStatus = 'ok' | 'not_found' | 'no_stock' | 'no_erp_id';

interface ResolveResponse {
  warehouse?: string;
  rows: {
    code: string;
    status: LookupStatus;
    item: CreateToStockItem | null;
  }[];
}

/** What the server read from an imported workbook (see backend to-import.ts). */
interface ImportResult {
  sheets: { name: string; rows: number }[];
  sheet: string | null;
  header_row: number | null;
  columns: Partial<Record<'code' | 'qty' | 'name' | 'description', string>>;
  rows: {
    line: number;
    code: string;
    qty_text: string;
    qty: number | null;
    name: string;
    description: string;
  }[];
  truncated: boolean;
  error?: string;
}

/** One pasted / imported line under review: what was read, what it matched, and the user's corrections. */
interface PreviewRow {
  key: number;
  /** Pasted line, or Excel row, it came from. */
  line: number;
  /** The PN as pasted / imported. */
  code: string;
  /** Import: the file's own item name, for comparison. */
  fileName?: string;
  qty: string;
  description: string;
  status: LookupStatus;
  item: CreateToStockItem | null;
}

/** A row ready to go to Selected Items. */
export interface QuickAddRow {
  item: CreateToStockItem;
  quantity: number;
  description: string;
}

const STATUS_TEXT: Record<Exclude<LookupStatus, 'ok'>, string> = {
  not_found: 'PN not found in Material Master',
  no_stock: 'No available stock in the sending warehouse',
  no_erp_id: 'Material has no ERP item id — sync it from ERP first',
};

const PLACEHOLDER = [
  '06.04209.0025\t10\tRak A',
  '06.04209.0025\t5\tRak B',
  '04.39535.9011\t20',
  '0220-609-9-Z61091, 12',
  'BY1000424655; 3',
].join('\n');

/** What is wrong with a row's qty, or null. */
function qtyError(row: PreviewRow): string | null {
  const v = row.qty.trim();
  if (v === '') return 'Missing qty';
  const q = Number(v.replace(',', '.'));
  if (!/^\d+([.,]\d+)?$/.test(v) || !Number.isFinite(q)) return `Invalid qty "${v}"`;
  if (q <= 0) return 'Qty must be above 0';
  if (row.item && !row.item.allows_decimal && !Number.isInteger(q)) return 'Whole numbers only';
  return null;
}

/** A row whose PN and qty are fine on their own (stock is checked over all rows of its PN). */
const basicOk = (r: PreviewRow) => r.status === 'ok' && !qtyError(r);
const qtyOf = (r: PreviewRow) => Number(r.qty.replace(',', '.'));

/**
 * Quick Add for Create TO: paste "PN, Qty, Description" rows (from Excel or a
 * list), check them against the Material Master and the sending warehouse's
 * stock, correct what needs it, then add every usable row to Selected Items —
 * one row per pasted line, repeated PNs included.
 */
export default function QuickAddModal({
  open,
  warehouseId,
  warehouseName,
  existing,
  roomLeft,
  onAdd,
  onClose,
}: {
  open: boolean;
  warehouseId: string;
  warehouseName: string;
  /** Qty already in Selected Items per material id. */
  existing: Map<string, number>;
  /** How many more rows the TO can take. */
  roomLeft: number;
  onAdd: (rows: QuickAddRow[]) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'paste' | 'review'>('paste');
  // Where the rows come from: a paste, or an imported workbook.
  const [source, setSource] = useState<'paste' | 'import'>('paste');
  const [imported, setImported] = useState<{
    file: File;
    result: ImportResult;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  // Every material the sending warehouse can transfer — the PN dropdown's options.
  const [stock, setStock] = useState<{
    warehouseId: string;
    items: CreateToStockItem[];
  } | null>(null);

  function close() {
    setStep('paste');
    setError('');
    setRows([]);
    onClose();
  }

  /** Read a workbook on the server (it is not stored): its sheets, and the rows of one. */
  async function upload(file: File, sheet?: string) {
    setError('');
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Choose an .xlsx file (Excel workbook).');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post<ImportResult>('/transfer-orders/create/import-parse', fd, { params: { sheet } });
      setImported({ file, result: r.data });
      if (r.data.error) setError(r.data.error);
    } catch (err) {
      const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
      setError(Array.isArray(m) ? m.join(', ') : (m ?? 'Reading the file failed.'));
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    downloadFile('/transfer-orders/create/import-template', {}, 'template_import_TO.xlsx').catch(() =>
      setError('Downloading the template failed.'),
    );
  }

  async function check() {
    setError('');
    let parsed: {
      rows: {
        line: number;
        code: string;
        qty: number | null;
        qtyText: string;
        description: string;
        fileName?: string;
      }[];
      notes: string[];
    };
    if (source === 'paste') {
      const p = parseQuickAdd(text);
      parsed = {
        rows: p.rows,
        notes: [
          ...(p.skippedHeader ? ['The header line was skipped.'] : []),
          ...(p.tooMany ? [`Only the first ${QUICK_ADD_MAX_LINES} lines were read.`] : []),
        ],
      };
    } else {
      const res = imported?.result;
      parsed = {
        rows: (res?.rows ?? []).map((r) => ({
          line: r.line,
          code: r.code,
          qty: r.qty,
          qtyText: r.qty_text,
          description: r.description,
          fileName: r.name || undefined,
        })),
        notes: res
          ? [
              `Read ${res.rows.length} row(s) of sheet "${res.sheet}" (header on row ${res.header_row}); "Line" is the Excel row.`,
              ...(res.truncated ? ['Only the first 500 rows were read.'] : []),
            ]
          : [],
      };
    }
    if (!parsed.rows.length) {
      setError(
        source === 'paste'
          ? 'Paste at least one line: PN, Qty and (optionally) Description.'
          : 'Upload an .xlsx file with at least one row.',
      );
      return;
    }
    const codes = [...new Set(parsed.rows.map((r) => r.code).filter(Boolean))];
    setChecking(true);
    try {
      const [r] = await Promise.all([
        codes.length
          ? api.post<ResolveResponse>('/transfer-orders/create/resolve-items', {
              warehouse_id: warehouseId,
              codes,
            })
          : Promise.resolve({ data: { rows: [] } as ResolveResponse }),
        stock?.warehouseId === warehouseId ? null : loadStock(),
      ]);
      const byCode = new Map(r.data.rows.map((x) => [x.code.toLowerCase(), x]));
      setRows(
        parsed.rows.map((p, i) => {
          const hit = byCode.get(p.code.toLowerCase());
          return {
            key: i,
            line: p.line,
            code: p.code,
            fileName: p.fileName,
            // An unreadable qty is shown as pasted, to be fixed here.
            qty: p.qty != null ? String(p.qty) : p.qtyText,
            description: p.description,
            status: hit?.status ?? 'not_found',
            item: hit?.item ?? null,
          };
        }),
      );
      setNotes(parsed.notes);
      setStep('review');
    } catch (err) {
      const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
      setError(Array.isArray(m) ? m.join(', ') : (m ?? 'Checking the Part Numbers failed.'));
    } finally {
      setChecking(false);
    }
  }

  /** Every page of the sending warehouse's transferable materials (100 per request). */
  async function loadStock() {
    const get = (page: number) =>
      api.get<Paginated<CreateToStockItem>>('/transfer-orders/create/items', {
        params: { warehouse_id: warehouseId, page, limit: 100 },
      });
    const first = await get(1);
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, (first.data.total_page ?? 1) - 1) }, (_, i) => get(i + 2)),
    );
    setStock({
      warehouseId,
      items: [first.data, ...rest.map((x) => x.data)].flatMap((d) => d.rows),
    });
  }

  const stockOptions = useMemo(
    () =>
      (stock?.items ?? []).map((m) => ({
        value: m.material_id,
        label:
          m.material_name && m.material_name !== m.material_code
            ? `${m.material_code} — ${m.material_name}`
            : m.material_code,
      })),
    [stock],
  );

  /** The PN picked in the dropdown replaces what was pasted (it has stock, so it is usable). */
  function pickMaterial(key: number, materialId: string) {
    const item = stock?.items.find((m) => m.material_id === materialId);
    if (item) patch(key, { item, status: 'ok' });
  }

  // ----- review -----

  /** Per material: the qty asked by its pasted rows plus what Selected Items already has. */
  const byMaterial = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.item || !basicOk(r)) continue;
      const id = r.item.material_id;
      m.set(id, (m.get(id) ?? existing.get(id) ?? 0) + qtyOf(r));
    }
    return m;
  }, [rows, existing]);

  /** Over the stock: every row of a PN whose rows together ask for more than is available. */
  const isOver = (r: PreviewRow) =>
    !!r.item && basicOk(r) && (byMaterial.get(r.item.material_id) ?? 0) > r.item.qty_available + EPS;
  const ready = rows.filter((r) => basicOk(r) && !isOver(r));

  /** The most this row can ask for, given the PN's other rows and Selected Items. */
  function roomFor(r: PreviewRow) {
    if (!r.item) return 0;
    const others = (byMaterial.get(r.item.material_id) ?? 0) - qtyOf(r);
    const room = Math.max(0, r.item.qty_available - others);
    return r.item.allows_decimal ? room : Math.floor(room + EPS);
  }
  // A row's PN: the matched material, else what was pasted.
  const pnKey = (r: PreviewRow) => r.item?.material_id ?? `code:${r.code.toLowerCase()}`;
  const codeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(pnKey(r), (m.get(pnKey(r)) ?? 0) + 1);
    return m;
  }, [rows]);

  function rowIssues(r: PreviewRow) {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (r.status !== 'ok') errors.push(r.code ? STATUS_TEXT[r.status] : 'Missing PN');
    const qe = qtyError(r);
    if (qe) errors.push(qe);
    if ((codeCount.get(pnKey(r)) ?? 0) > 1) warnings.push('Repeated PN — kept as its own row');
    if (r.item && (existing.get(r.item.material_id) ?? 0) > 0) warnings.push('Also in Selected Items');
    if (r.item && isOver(r)) {
      const total = byMaterial.get(r.item.material_id) ?? 0;
      const inSelected = existing.get(r.item.material_id) ?? 0;
      errors.push(
        `Over stock by ${fmt(total - r.item.qty_available)} — available ${fmt(r.item.qty_available)}` +
          ((codeCount.get(pnKey(r)) ?? 0) > 1 || inSelected > 0
            ? `, asked ${fmt(total)} across ${inSelected > 0 ? 'these rows and Selected Items' : 'all rows of this PN'}`
            : ''),
      );
    }
    return { errors, warnings };
  }

  const counts = rows.reduce(
    (c, r) => {
      const { errors, warnings } = rowIssues(r);
      if (r.status === 'not_found') c.notFound++;
      else if (r.status === 'no_stock') c.noStock++;
      else if (isOver(r)) c.over++;
      else if (errors.length) c.invalid++;
      if (warnings.some((w) => w.startsWith('Repeated PN'))) c.repeated++;
      return c;
    },
    { notFound: 0, noStock: 0, invalid: 0, repeated: 0, over: 0 },
  );

  function patch(key: number, p: Partial<PreviewRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  // Every row must be fixed (or removed) before anything is added.
  const failed = rows.length - ready.length;

  function add() {
    if (failed > 0) {
      setError(`Fix or remove the ${failed} row(s) with errors first.`);
      return;
    }
    if (ready.length > roomLeft) {
      setError(`Selected Items can take ${roomLeft} more row(s); ${ready.length} are ready. Remove some rows first.`);
      return;
    }
    onAdd(
      ready.map((r) => ({
        item: r.item!,
        quantity: Number(r.qty.replace(',', '.')),
        description: r.description.trim(),
      })),
    );
    setText('');
    setImported(null);
    close();
  }

  const chip = (label: string, n: number, cls: string) =>
    n > 0 && (
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
        {n} {label}
      </span>
    );

  return (
    <DocModal
      open={open}
      title="Quick Add Materials"
      subtitle={`Paste or import Part Numbers and quantities — matched against the stock of ${warehouseName}.`}
      error={error}
      note={
        step === 'review'
          ? failed > 0
            ? `${failed} row(s) with errors — fix or remove them to add the rows`
            : `All ${rows.length} row(s) ready`
          : source === 'paste'
            ? 'One line per row: PN, Qty, Description (optional)'
            : 'Columns: Kode Material, Jumlah Transfer, Nama Item (optional), Keterangan (optional)'
      }
      primaryLabel={step === 'paste' ? 'Check' : `Add ${ready.length} row(s)`}
      primaryBusyLabel="Checking…"
      busy={checking || uploading}
      primaryDisabled={
        step === 'paste'
          ? source === 'paste'
            ? !text.trim()
            : !imported?.result.rows.length
          : rows.length === 0 || failed > 0
      }
      onPrimary={step === 'paste' ? check : add}
      onClose={close}
    >
      {step === 'paste' ? (
        <div className="space-y-4">
          <div
            role="tablist"
            className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-1 text-sm dark:border-slate-700 dark:bg-slate-900/40"
          >
            {(
              [
                ['paste', 'Paste'],
                ['import', 'Import Excel'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={source === v}
                onClick={() => {
                  setSource(v);
                  setError('');
                }}
                className={`rounded-md px-4 py-1.5 font-medium transition ${
                  source === v
                    ? 'bg-white text-[#5166AE] shadow-sm dark:bg-slate-800'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {source === 'paste' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#E1E4F8] bg-[#F5F6FD] px-4 py-3 text-xs text-[#3F4F8C] dark:border-[#5166AE]/30 dark:bg-[#5166AE]/10 dark:text-[#c7cff0]">
                <p className="font-semibold">Format</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>
                    One line per row: <b>PN</b>, <b>Qty</b>, <b>Description</b> (optional). Copy the columns straight
                    from Excel (Tab), or separate them with <code>,</code> or <code>;</code>.
                  </li>
                  <li>Separated by spaces only: the last word is the qty and there is no description.</li>
                  <li>
                    The same PN may appear on several lines — each line becomes its own row. A header line is skipped.
                  </li>
                  <li>
                    Qty: a plain number (decimals with "." or ","), no thousand separators. Up to {QUICK_ADD_MAX_LINES}{' '}
                    lines.
                  </li>
                </ul>
              </div>
              <textarea
                className="min-h-[220px] w-full rounded-lg border border-neutral-200 px-3 py-2.5 font-mono text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-[#5166AE] focus:ring-2 focus:ring-[#5166AE]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={PLACEHOLDER}
                aria-label="Pasted Part Numbers and quantities"
                autoFocus
              />
              <p className="text-xs text-neutral-500">{text.split(/\r?\n/).filter((l) => l.trim()).length} line(s)</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[#E1E4F8] bg-[#F5F6FD] px-4 py-3 text-xs text-[#3F4F8C] dark:border-[#5166AE]/30 dark:bg-[#5166AE]/10 dark:text-[#c7cff0]">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Excel layout</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>
                      Columns found by their header: <b>Kode Material</b> and <b>Jumlah Transfer</b> (required),{' '}
                      <b>Nama Item</b> and <b>Keterangan</b> (optional) — Chinese / Indonesian / English headers, any
                      order.
                    </li>
                    <li>Title rows above the header and extra columns (e.g. Nomor seri) are fine.</li>
                    <li>Keterangan becomes the row's Description; Nama Item is only shown for comparison.</li>
                    <li>The same Kode Material may be on several rows — each row stays its own line.</li>
                  </ul>
                </div>
                <button type="button" className="btn-secondary shrink-0" onClick={downloadTemplate}>
                  <Lucide>{icons.download}</Lucide>
                  Download template
                </button>
              </div>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) upload(f);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition ${
                  dragOver
                    ? 'border-[#5166AE] bg-[#F5F6FD]'
                    : 'border-neutral-200 hover:border-[#5166AE]/60 hover:bg-neutral-50'
                }`}
              >
                <span className="text-[#5166AE]">
                  <Lucide>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="m17 8-5-5-5 5M12 3v12" />
                  </Lucide>
                </span>
                <span className="font-medium text-neutral-800 dark:text-slate-100">
                  {uploading
                    ? 'Reading the file…'
                    : imported
                      ? 'Choose another file'
                      : 'Drop the .xlsx here or click to choose'}
                </span>
                <span className="text-xs text-neutral-500">
                  Excel workbook (.xlsx), up to 5 MB and 500 rows per sheet
                </span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(f);
                    e.target.value = '';
                  }}
                  aria-label="Choose an Excel file to import"
                />
              </label>
              {imported && (
                <div className="space-y-2 rounded-lg border border-neutral-200 px-4 py-3 text-sm dark:border-slate-700">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-medium text-neutral-800 dark:text-slate-100">{imported.file.name}</span>
                    {imported.result.sheets.length > 1 && (
                      <label className="flex items-center gap-2 text-xs text-neutral-500">
                        Sheet
                        <select
                          className="input w-auto py-1 text-xs"
                          value={imported.result.sheet ?? ''}
                          onChange={(e) => upload(imported.file, e.target.value)}
                        >
                          {imported.result.sheets.map((sh) => (
                            <option key={sh.name} value={sh.name}>
                              {sh.name} ({sh.rows} rows)
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {imported.result.header_row != null && (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        {imported.result.rows.length} row(s) read
                      </span>
                    )}
                  </div>
                  {imported.result.header_row != null && (
                    <p className="text-xs text-neutral-500">
                      Header on row {imported.result.header_row}:{' '}
                      {(['code', 'qty', 'name', 'description'] as const)
                        .filter((f) => imported.result.columns[f])
                        .map((f) => imported.result.columns[f])
                        .join(' · ')}
                      {!imported.result.columns.description && ' — no Keterangan column, descriptions stay empty'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-[#5166AE] hover:underline"
              onClick={() => setStep('paste')}
            >
              <Lucide>{icons.chevronLeft}</Lucide> {source === 'paste' ? 'Edit pasted data' : 'Change file'}
            </button>
            <span className="mx-1 h-4 w-px bg-neutral-200" />
            {chip('ready', ready.length, 'bg-emerald-50 text-emerald-700')}
            {chip('not found', counts.notFound, 'bg-rose-50 text-rose-700')}
            {chip('no stock', counts.noStock, 'bg-rose-50 text-rose-700')}
            {chip('invalid', counts.invalid, 'bg-rose-50 text-rose-700')}
            {chip('repeated PN', counts.repeated, 'bg-amber-50 text-amber-700')}
            {chip('over stock', counts.over, 'bg-rose-50 text-rose-700')}
          </div>
          {notes.length > 0 && <p className="text-xs text-neutral-500">{notes.join(' ')}</p>}
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-slate-900/40">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium">
                  <th>Line</th>
                  <th>Part Number</th>
                  <th>Material</th>
                  <th className="text-right">Available</th>
                  <th className="w-32">Qty</th>
                  <th className="w-48">Description</th>
                  <th className="min-w-[240px]">Status</th>
                  <th className="w-10" aria-label="Remove" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-slate-700">
                {rows.map((r) => {
                  const { errors, warnings } = rowIssues(r);
                  const bad = errors.length > 0;
                  return (
                    <tr
                      key={r.key}
                      className={bad ? 'bg-rose-50/60 dark:bg-rose-950/20' : warnings.length ? 'bg-amber-50/40' : ''}
                    >
                      <td className="px-3 py-2 text-neutral-400">{r.line}</td>
                      <td className="px-3 py-2">
                        <SearchableSelect
                          className="w-60"
                          value={r.status === 'ok' && r.item ? r.item.material_id : ''}
                          onChange={(id) => pickMaterial(r.key, id)}
                          options={stockOptions}
                          placeholder={r.code || 'Select PN…'}
                          searchPlaceholder="Search PN or material name…"
                          emptyText="No material with stock matches"
                        />
                        {r.item &&
                          r.status === 'ok' &&
                          r.item.material_code.toLowerCase() !== r.code.toLowerCase() &&
                          r.code && <div className="mt-0.5 text-[11px] text-neutral-400">Pasted: {r.code}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {r.item ? (
                          <div className="max-w-[14rem] truncate" title={r.item.material_name ?? ''}>
                            {r.item.material_name ?? '-'}
                          </div>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                        {r.fileName && r.fileName !== r.item?.material_name && (
                          <div className="max-w-[14rem] truncate text-[11px] text-neutral-400" title={r.fileName}>
                            File: {r.fileName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.item ? fmt(r.item.qty_available) : '—'}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={`input min-w-[88px] text-right ${(qtyError(r) && r.status === 'ok') || isOver(r) ? 'border-red-400' : ''}`}
                          value={r.qty}
                          onChange={(e) => patch(r.key, { qty: e.target.value })}
                          disabled={r.status !== 'ok'}
                          aria-label={`Qty for line ${r.line}`}
                        />
                        {isOver(r) &&
                          (roomFor(r) > 0 ? (
                            <button
                              type="button"
                              className="mt-1 whitespace-nowrap text-xs font-medium text-[#5166AE] hover:underline"
                              onClick={() => patch(r.key, { qty: String(roomFor(r)) })}
                            >
                              Use max {fmt(roomFor(r))}
                            </button>
                          ) : (
                            <p className="mt-1 whitespace-nowrap text-xs text-red-600">No stock left</p>
                          ))}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="input"
                          value={r.description}
                          maxLength={300}
                          onChange={(e) => patch(r.key, { description: e.target.value })}
                          disabled={r.status !== 'ok'}
                          placeholder="Optional"
                          aria-label={`Description for line ${r.line}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {bad ? (
                          <span className="font-medium text-rose-700">✕ {errors.join(' · ')}</span>
                        ) : (
                          <span className="font-medium text-emerald-700">✓ Ready</span>
                        )}
                        {warnings.map((w) => (
                          <div key={w} className="mt-0.5 text-amber-700">
                            ⚠ {w}
                          </div>
                        ))}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove line ${r.line}`}
                        >
                          <Lucide>{icons.trash}</Lucide>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-neutral-400">
                      Every line was removed. Go back to paste again.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {failed > 0 && (
            <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
              <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
              </svg>
              <span>
                <b>{failed} row(s) still have errors.</b> Nothing is added until every row is ready: pick the right PN
                in the dropdown, correct the qty{counts.over > 0 ? ' (or “Use max”)' : ''}, or remove the row with 🗑.
              </span>
            </div>
          )}
        </div>
      )}
    </DocModal>
  );
}
