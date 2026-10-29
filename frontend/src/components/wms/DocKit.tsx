import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lucide, MasterPager, SearchBox, icons } from '../master/MasterKit';

/*
 * Building blocks of WMS dev's document pages (Goods Receive, Putaway, …),
 * with its exact Tailwind classes: the page card, the detail header with its
 * back button, the grey info grid, document status pills, the – qty + stepper
 * and a searchable, paged table for a document's material list.
 */

/** A list page: title, description, then the list — all in one white card. */
export function PageCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mt-2 space-y-5 rounded-xl bg-white p-5 shadow-md dark:bg-slate-800">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-neutral-900 dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-neutral-600 dark:text-slate-400">{description}</p>}
      </div>
      <div className="pt-1">{children}</div>
    </div>
  );
}

/** A detail page: ‹ back, title, actions on the right, then the content. */
export function DetailCard({
  title,
  backTo,
  actions,
  children,
}: {
  title: string;
  backTo: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="mt-2 space-y-5 rounded-xl bg-white p-5 shadow-md dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => navigate(backTo)}
            aria-label="Back"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <Lucide>{icons.chevronLeft}</Lucide>
          </button>
          <div className="text-xl font-semibold text-neutral-900 dark:text-white">{title}</div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** The grey box of a document's header fields. */
export function InfoGrid({
  fields,
  footer,
  columns = 4,
}: {
  fields: { label: string; value: ReactNode }[];
  footer?: ReactNode;
  /** WMS dev's adjustment detail lays the fields out in two columns. */
  columns?: 2 | 4;
}) {
  return (
    <div className="rounded-lg bg-neutral-50 p-4 ring-1 ring-neutral-200 dark:bg-slate-900/40 dark:ring-slate-700">
      <div
        className={`grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 ${
          columns === 4 ? 'lg:grid-cols-4 lg:gap-x-16 lg:gap-y-8' : 'lg:gap-x-16 lg:gap-y-6'
        }`}
      >
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <div className="text-sm font-semibold text-neutral-900 dark:text-white">{f.label}</div>
            <div className="mt-1 min-w-0 break-words text-sm text-neutral-800 dark:text-slate-200">
              {f.value === null || f.value === undefined || f.value === '' ? '-' : f.value}
            </div>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  Open: 'bg-[#E0F2FE] text-[#0284C7] ring-[#0284C7]',
  'On Progress': 'bg-[#FEF3C7] text-[#B45309] ring-[#B45309]',
  Closed: 'bg-[#EFFAF4] text-[#2E8F5C] ring-[#2E8F5C]',
  'Sync Failed': 'bg-[#FEF2F2] text-[#B91C1C] ring-[#B91C1C]',
};

/** "OnProgress" → "On Progress", "SyncFailed" → "Sync Failed". */
export function statusLabel(status: string | null | undefined) {
  return (status ?? '-').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function DocStatusPill({ status }: { status: string | null | undefined }) {
  const label = statusLabel(status);
  return (
    <span
      title={label}
      className={`inline-flex w-[130px] items-center justify-center rounded-full py-1 text-center text-[12px] font-medium ring-1 ${
        STATUS_STYLE[label] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-300'
      }`}
    >
      <span className="truncate px-2">{label}</span>
    </span>
  );
}

const BTN = 'inline-flex h-[34px] shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** WMS dev's indigo primary button (Receive, Generate Putaway, Putaway, …). */
export function PrimaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...p} className={`${BTN} bg-[#5166AE] text-white hover:bg-[#41528c]`}>
      {children}
    </button>
  );
}

/** The green Confirm of an inline Receive / Putaway. */
export function ConfirmButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...p} className={`${BTN} bg-green-600 text-white hover:bg-green-700`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className={`${BTN} border border-neutral-200 bg-white font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200`}
    >
      {children}
    </button>
  );
}

/** WMS dev's rounded – qty + stepper. */
export function Stepper({
  value,
  onChange,
  max,
  min = 0,
  disabled,
  invalid,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
  min?: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const clamp = (v: number) => Math.max(min, max != null ? Math.min(max, v) : v);
  const btn =
    'flex h-full w-9 shrink-0 items-center justify-center text-lg text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div
      className={`relative inline-flex h-8 w-[130px] items-center overflow-hidden rounded-full border bg-neutral-50 shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 hover:border-neutral-300 ${
        invalid ? 'border-red-400' : 'border-neutral-200'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <button type="button" className={btn} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))} aria-label="Decrease">
        –
      </button>
      <div className="relative flex h-full flex-1 flex-col items-center justify-center border-x border-neutral-200 bg-white">
        <input
          inputMode="decimal"
          disabled={disabled}
          className="w-full bg-transparent px-1 text-center text-sm font-normal text-neutral-900 outline-none"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value.replace(',', '.'));
            if (e.target.value === '') onChange(0);
            else if (Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => onChange(clamp(value))}
        />
      </div>
      <button
        type="button"
        className={btn}
        disabled={disabled || (max != null && value >= max)}
        onClick={() => onChange(clamp(value + 1))}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

export interface DocColumn<T> {
  label: string;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
}

/**
 * A document's Material List: "Search by Material Name or Code…", the table
 * in WMS dev's style, and the pager — searched and paged on the client.
 */
export function DocTable<T extends { id: string }>({
  rows,
  columns,
  searchText,
  searchPlaceholder = 'Search by Material Name or Code...',
  empty = 'No materials.',
  rowClass,
  topRow,
}: {
  rows: T[];
  columns: DocColumn<T>[];
  /** Text a row is searched on; omit to hide the search box. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  empty?: string;
  rowClass?: (row: T) => string;
  /** An extra first body row (e.g. "Picker for all items"). */
  topRow?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
  }, [rows, search, searchText]);
  const start = (page - 1) * pageSize;
  const shown = filtered.slice(start, start + pageSize);
  const th =
    'whitespace-nowrap border-b border-neutral-100 bg-white px-2.5 py-2 text-sm font-medium text-neutral-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
  const td = 'whitespace-nowrap px-2.5 py-2.5 align-middle text-sm text-neutral-900 dark:text-slate-100';
  const alignCls = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  return (
    <div className="space-y-3">
      {searchText && (
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={searchPlaceholder}
        />
      )}
      <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="relative w-full overflow-x-auto [scrollbar-width:thin]">
          <table className="w-full border-separate border-spacing-0 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className={`${th} ${alignCls(c.align)}`} style={c.width ? { minWidth: c.width } : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topRow}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-2.5 py-10 text-center text-sm text-neutral-500">
                    {empty}
                  </td>
                </tr>
              ) : (
                shown.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50 dark:hover:bg-slate-700/40 ${rowClass?.(r) ?? ''}`}
                  >
                    {columns.map((c) => (
                      <td key={c.label} className={`${td} border-b border-neutral-100 dark:border-slate-700 ${alignCls(c.align)}`}>
                        {c.render(r, start + i)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <MasterPager
        page={page}
        pageSize={pageSize}
        total={filtered.length}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </div>
  );
}

/** "2026-10-19 15:14:54", as WMS dev prints a document's timestamps. */
export function fmtStamp(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const qty = (n: number | null | undefined) =>
  n == null ? '-' : n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * WMS dev's document modal: a wide rounded dialog with a title, a scrolling
 * body and a footer holding a note, Cancel and the primary action.
 */
export function DocModal({
  open,
  title,
  subtitle,
  error,
  note,
  primaryLabel,
  primaryBusyLabel,
  busy,
  primaryDisabled,
  onPrimary,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  error?: string;
  note?: ReactNode;
  primaryLabel: string;
  primaryBusyLabel?: string;
  busy?: boolean;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[90vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.32)] dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5 dark:border-slate-700">
          <div>
            <h2 className="text-2xl font-semibold leading-snug text-neutral-900 dark:text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] text-neutral-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-slate-700"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
          )}
          {children}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50/60 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="text-xs text-neutral-500">{note}</div>
          <div className="flex gap-2">
            <SecondaryButton onClick={onClose} disabled={busy}>
              Cancel
            </SecondaryButton>
            <PrimaryButton onClick={onPrimary} disabled={busy || primaryDisabled}>
              {busy ? (primaryBusyLabel ?? 'Saving…') : primaryLabel}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Read-only field of a modal's document header. */
export function ReadOnlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-slate-400">{label}</div>
      <div className="flex h-9 items-center rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
        <span className="truncate">{value || '-'}</span>
      </div>
    </div>
  );
}
