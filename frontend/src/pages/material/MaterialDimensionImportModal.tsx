import { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { DocModal } from '../../components/wms/DocKit';
import { useToast } from '../../context/ToastContext';

interface DimensionChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

interface PreviewRow {
  line: number;
  material_code: string;
  erp_doc_id: string | null;
  material_name: string | null;
  material_id: string | null;
  status: 'update' | 'unchanged' | 'error';
  errors: string[];
  changes: DimensionChange[];
  payload: Record<string, string | number> | null;
}

interface Preview {
  sheet: string | null;
  columns: string[];
  truncated: boolean;
  summary: { rows: number; update: number; unchanged: number; error: number };
  rows: PreviewRow[];
}

type Tab = 'update' | 'error' | 'unchanged' | 'all';

/** Rows drawn at once in the preview table; the counts above cover every row. */
const SHOW_MAX = 300;

const message = (err: unknown, fallback: string) => {
  const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

const shown = (v: string | number | null) => (v == null || v === 0 ? '-' : String(v));

const STATUS_PILL: Record<PreviewRow['status'], string> = {
  update: 'border-blue-300 bg-blue-50 text-blue-700',
  unchanged: 'border-slate-300 bg-slate-50 text-slate-600',
  error: 'border-red-300 bg-red-50 text-red-700',
};
const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  update: 'Will update',
  unchanged: 'No change',
  error: 'Error',
};

/**
 * Materials — Import Dimensions: download the template (the materials with
 * their current dimensions), upload it back, check the preview, then Apply.
 * Empty cells leave the stored value as it is.
 */
export default function MaterialDimensionImportModal({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tab, setTab] = useState<Tab>('update');
  const [error, setError] = useState('');

  const rows = useMemo(
    () => (preview?.rows ?? []).filter((r) => tab === 'all' || r.status === tab),
    [preview, tab],
  );

  function reset() {
    setFile(null);
    setPreview(null);
    setError('');
    setTab('update');
    if (fileInput.current) fileInput.current.value = '';
  }

  function close() {
    if (applying) return;
    reset();
    setSearch('');
    onClose();
  }

  async function downloadTemplate() {
    setError('');
    setDownloading(true);
    try {
      await downloadFile(
        '/materials/dimension-import/template',
        search.trim() ? { search: search.trim() } : {},
        'material_dimensions.xlsx',
      );
    } catch {
      setError('Downloading the template failed.');
    } finally {
      setDownloading(false);
    }
  }

  async function check(f: File) {
    setError('');
    setPreview(null);
    if (!/\.xlsx$/i.test(f.name)) {
      setError('Choose an .xlsx file (Excel workbook).');
      return;
    }
    setChecking(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api.post<Preview>('/materials/dimension-import/preview', fd);
      setPreview(r.data);
      setTab(r.data.summary.update ? 'update' : r.data.summary.error ? 'error' : 'all');
    } catch (err) {
      setError(message(err, 'Checking the file failed.'));
    } finally {
      setChecking(false);
    }
  }

  async function apply() {
    if (!preview) return;
    const payload = preview.rows.filter((r) => r.status === 'update' && r.payload).map((r) => r.payload!);
    if (!payload.length) return;
    setError('');
    setApplying(true);
    try {
      const r = await api.post<{ updated: number }>('/materials/dimension-import/apply', { rows: payload });
      toast.success(`Dimensions updated for ${r.data.updated} material${r.data.updated === 1 ? '' : 's'}.`);
      reset();
      setSearch('');
      onApplied();
      onClose();
    } catch (err) {
      setError(message(err, 'Saving the dimensions failed.'));
    } finally {
      setApplying(false);
    }
  }

  const s = preview?.summary;
  const tabs: [Tab, string, number][] = s
    ? [
        ['update', 'Will update', s.update],
        ['error', 'Errors', s.error],
        ['unchanged', 'No change', s.unchanged],
        ['all', 'All', s.rows],
      ]
    : [];

  return (
    <DocModal
      open={open}
      title="Import Dimensions"
      subtitle="Fill or edit Length, Width, Height, UoD, Weight and Weight UoM of materials from an Excel file."
      error={error}
      note={
        s
          ? s.error
            ? `${s.error} row${s.error === 1 ? '' : 's'} with errors will be skipped.`
            : 'Nothing is saved until you click Apply.'
          : 'Empty cells keep the current value.'
      }
      primaryLabel={s ? `Apply ${s.update} change${s.update === 1 ? '' : 's'}` : 'Apply'}
      primaryBusyLabel="Applying…"
      busy={applying}
      primaryDisabled={!s || s.update === 0 || checking}
      onPrimary={apply}
      onClose={close}
    >
      {/* Step 1: template */}
      <section className="rounded-xl border border-neutral-200 p-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-slate-100">1. Download the template</h3>
        <p className="mt-1 text-[13px] text-neutral-500">
          It lists the materials with their current dimensions. Leave the filter empty for every material, or type part
          of a code or name to get only those.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-xs"
            placeholder="Filter by Material Code or Name (optional)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && downloadTemplate()}
          />
          <button type="button" className="btn-secondary" onClick={downloadTemplate} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download Template'}
          </button>
        </div>
      </section>

      {/* Step 2: upload */}
      <section className="rounded-xl border border-neutral-200 p-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-slate-100">2. Upload the filled file</h3>
        <p className="mt-1 text-[13px] text-neutral-500">
          Rows are matched by Material Code (or ERP Doc ID). An empty cell keeps the current value; enter 0 to clear a
          number.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) void check(f);
            }}
            disabled={checking || applying}
          />
          {checking && <span className="text-sm text-neutral-500">Checking…</span>}
          {file && !checking && preview && (
            <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => check(file)}>
              Check again
            </button>
          )}
        </div>
      </section>

      {/* Step 3: preview */}
      {preview && s && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-slate-100">
              3. Check the preview{' '}
              <span className="font-normal text-neutral-500">
                — sheet “{preview.sheet}”, {s.rows} row{s.rows === 1 ? '' : 's'}, columns: {preview.columns.join(', ')}
              </span>
            </h3>
          </div>
          {preview.truncated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              The file has more rows than one import can take; only the first {s.rows} were read.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {tabs.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  tab === key
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {label} ({count})
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-slate-700">
            <div className="max-h-[45vh] overflow-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-slate-700">
                <thead className="sticky top-0 z-10 bg-neutral-50 text-left text-xs text-neutral-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 font-medium">Line</th>
                    <th className="px-3 py-2 font-medium">Material Code</th>
                    <th className="px-3 py-2 font-medium">ERP Doc ID</th>
                    <th className="px-3 py-2 font-medium">Material Name</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Changes / Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white dark:divide-slate-700 dark:bg-slate-800">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">
                        No rows here.
                      </td>
                    </tr>
                  ) : (
                    rows.slice(0, SHOW_MAX).map((r) => (
                      <tr key={r.line} className="align-top">
                        <td className="px-3 py-2 text-neutral-500">{r.line}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-800 dark:text-slate-100">
                          {r.material_code || '-'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{r.erp_doc_id ?? '-'}</td>
                        <td className="px-3 py-2 text-neutral-600">{r.material_name ?? '-'}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[r.status]}`}
                          >
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.errors.length > 0 ? (
                            <ul className="list-disc space-y-0.5 pl-4 text-red-700">
                              {r.errors.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          ) : r.changes.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {r.changes.map((c) => (
                                <span
                                  key={c.field}
                                  className="whitespace-nowrap rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-slate-700 dark:text-slate-200"
                                >
                                  {c.label}: <span className="text-neutral-400 line-through">{shown(c.from)}</span> →{' '}
                                  <span className="font-semibold text-neutral-900 dark:text-white">{shown(c.to)}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-neutral-400">Same as stored</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {rows.length > SHOW_MAX && (
            <p className="text-xs text-neutral-500">
              Showing the first {SHOW_MAX} of {rows.length} rows in this tab. Apply covers every row marked “Will update”.
            </p>
          )}
        </section>
      )}
    </DocModal>
  );
}
