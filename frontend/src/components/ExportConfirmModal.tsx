import { useEffect, useState, type ReactNode } from 'react';

export type ExportScope = 'filtered' | 'all';

/** What one export option would download, as counted by the backend. */
export interface ExportCounts {
  documents: number;
  rows: number;
}

export interface ExportSummary {
  filtered: ExportCounts;
  all: ExportCounts;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * Asks what to export before downloading: the data the list's filters match,
 * or all data. Each option shows how many documents and rows it holds, as
 * the backend counts them, so the user knows the size of the file first.
 * Nothing on the list (its filters, page or data) changes.
 */
export default function ExportConfirmModal({
  open,
  onClose,
  filters,
  loadSummary,
  onConfirm,
  documentLabel = 'Documents',
}: {
  open: boolean;
  onClose: () => void;
  /** The list's active filters as shown to the user. */
  filters: { label: string; value: string }[];
  loadSummary: () => Promise<ExportSummary>;
  onConfirm: (scope: ExportScope) => void;
  documentLabel?: string;
}) {
  const hasFilters = filters.length > 0;
  const [scope, setScope] = useState<ExportScope>('filtered');
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [error, setError] = useState('');

  // Counted afresh on every open: the data may have changed since.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setScope(hasFilters ? 'filtered' : 'all');
    setSummary(null);
    setError('');
    loadSummary()
      .then((s) => active && setSummary(s))
      .catch(() => active && setError('Could not count the data to export. Please try again.'));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = summary?.[scope];
  const empty = !!chosen && chosen.rows === 0;

  if (!open) return null;
  const loading = !summary && !error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-confirm-title"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-slate-700">
              <DownloadIcon className="h-5 w-5" />
            </span>
            <h3 id="export-confirm-title" className="text-xl font-semibold text-slate-900 dark:text-white">
              Confirm Export
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Options */}
        <div className="space-y-3 px-6 pb-5 pt-4">
          <p className="text-base text-slate-700 dark:text-slate-200">Which data do you want to export?</p>

          <Option
            selected={scope === 'filtered'}
            disabled={!hasFilters}
            onSelect={() => setScope('filtered')}
            icon={<FilterIcon className="h-6 w-6" />}
            title="Export Filtered Data"
            subtitle="Only the data that matches the active filters."
          >
            <InfoPill>
              {hasFilters ? (
                <>
                  <span className="text-slate-500">Current filter:</span>
                  {filters.map((f, i) => (
                    <span
                      key={`${f.label}-${i}`}
                      className="rounded-md bg-brand-100 px-2 py-0.5 font-medium text-brand-700 dark:bg-slate-600 dark:text-slate-100"
                    >
                      {f.label}: {f.value}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-slate-500">No filters are active, so this is the same as all data.</span>
              )}
              <Totals counts={summary?.filtered} loading={loading} documentLabel={documentLabel} />
            </InfoPill>
          </Option>

          <Option
            selected={scope === 'all'}
            onSelect={() => setScope('all')}
            icon={<LayersIcon className="h-6 w-6" />}
            title="Export All Data"
            subtitle="Every record you have access to, whatever the filters."
          >
            <InfoPill>
              <Totals counts={summary?.all} loading={loading} documentLabel={documentLabel} first />
            </InfoPill>
          </Option>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {empty && <p className="text-sm text-amber-700">There is nothing to export for this option.</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40">
          <button type="button" className="btn-secondary px-6" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 px-6"
            disabled={!summary || empty}
            onClick={() => onConfirm(scope)}
          >
            <DownloadIcon className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

function Option({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  subtitle,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
        disabled
          ? 'cursor-not-allowed border-slate-200 opacity-60 dark:border-slate-700'
          : selected
            ? 'cursor-pointer border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 dark:bg-slate-700/40'
            : 'cursor-pointer border-slate-200 hover:border-slate-300 dark:border-slate-700'
      }`}
    >
      <input
        type="radio"
        name="export-scope"
        className="mt-1 h-5 w-5 shrink-0 accent-brand-600"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className={`mt-0.5 shrink-0 ${selected ? 'text-brand-600' : 'text-slate-600 dark:text-slate-300'}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        {children}
      </div>
    </label>
  );
}

/** The grey summary pill under an option. */
function InfoPill({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
      {children}
    </div>
  );
}

function Totals({
  counts,
  loading,
  documentLabel,
  first,
}: {
  counts: ExportCounts | undefined;
  loading: boolean;
  documentLabel: string;
  /** Nothing before it in the pill, so no leading divider. */
  first?: boolean;
}) {
  const value = (n: number | undefined) => (loading ? '…' : n != null ? fmt(n) : '-');
  return (
    <>
      {!first && <span className="text-slate-300 dark:text-slate-500">|</span>}
      <span>
        {documentLabel}: <strong className="font-semibold">{value(counts?.documents)}</strong>
      </span>
      <span className="text-slate-300 dark:text-slate-500">|</span>
      <span>
        Rows: <strong className="font-semibold">{value(counts?.rows)}</strong>
      </span>
    </>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0-4-4m4 4 4-4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8.5V19l-4 2v-8.5L3 4Z" />
    </svg>
  );
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}
