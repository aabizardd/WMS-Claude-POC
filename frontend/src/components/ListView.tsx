import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Modal from './Modal';
import ToolbarMenu, { type ToolbarMenuItem } from './ToolbarMenu';

/**
 * Building blocks shared by the list pages that carry their own tracking
 * (Inventory, Transfer Order, Inventory Sales), so they all look and behave
 * the same: a filter panel, an "Additional filters" dialog, Expand/Collapse
 * all, and rows that open into a preview of their lines.
 */

/**
 * The page title and subtitle at the top of a list card. The ☰ menu (Export,
 * Print…) always sits in the top-right corner, after any other actions.
 */
export function ListHeader({
  title,
  subtitle,
  actions,
  menu,
}: {
  title: string;
  subtitle: ReactNode;
  actions?: ReactNode;
  menu?: ToolbarMenuItem[];
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
        <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
      </div>
      {(actions || menu?.length) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {menu && menu.length > 0 && <ToolbarMenu items={menu} />}
        </div>
      )}
    </div>
  );
}

/**
 * "Total …" cards above a list's table: sums over every row matching the
 * filters, not only the current page.
 */
export function TotalCards({
  items,
  gridClass = 'grid-cols-2 sm:grid-cols-4',
}: {
  /** A card with a link opens the documents behind its total, in a new tab. */
  items: [label: string, value: number, href?: string][];
  gridClass?: string;
}) {
  return (
    <div className={`mx-5 mb-3 grid gap-2 ${gridClass}`}>
      {items.map(([label, value, href]) =>
        href ? (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50/40"
            title={`See the documents behind the total ${label.toLowerCase()}`}
          >
            <div className="text-[11px] text-slate-500">Total {label}</div>
            <div className="flex items-center gap-1 text-lg font-semibold text-brand-700">
              {value.toLocaleString()}
              <svg className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4" />
              </svg>
            </div>
          </a>
        ) : (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] text-slate-500">Total {label}</div>
            <div className="text-lg font-semibold text-slate-800">{value.toLocaleString()}</div>
          </div>
        ),
      )}
    </div>
  );
}

export interface ActiveChip {
  label: string;
  value: string;
}

/**
 * The grey filter box: the primary fields (children), the "Additional
 * filters" button with its applied count, Clear, a toolbar on the right and
 * the active filters as chips.
 */
export function ListFilterPanel({
  children,
  columns = 3,
  extraCount,
  onOpenExtras,
  onClear,
  toolbar,
  chips,
  chipsNote,
  footer,
}: {
  children: ReactNode;
  /** Primary fields per row on wide screens. */
  columns?: 3 | 4;
  extraCount: number;
  onOpenExtras: () => void;
  /** Shown only when there is something to clear. */
  onClear?: () => void;
  toolbar?: ReactNode;
  chips: ActiveChip[];
  /** A hint after the chips, e.g. that open rows show only matching lines. */
  chipsNote?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div className={`grid gap-3 sm:grid-cols-2 ${columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {children}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={onOpenExtras}>
            + Additional filters
            {extraCount > 0 && (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
                {extraCount}
              </span>
            )}
          </button>
          {onClear && (
            <button type="button" className="btn-secondary" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-3 text-xs">
          <span className="text-slate-400">Active:</span>
          {chips.map((c, i) => (
            <span key={i} className="rounded bg-white px-2 py-0.5 text-slate-600 ring-1 ring-slate-200">
              {c.label}: <b className="font-medium">{c.value}</b>
            </span>
          ))}
          {chipsNote && <span className="text-slate-400">· {chipsNote}</span>}
        </div>
      )}
      {footer}
    </div>
  );
}

/** One labelled field in the filter panel or the additional filters dialog. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

/** The "Additional filters" dialog: two columns of fields, Reset and Apply. */
export function ExtraFiltersModal({
  open,
  onClose,
  onReset,
  onApply,
  intro = 'These narrow the list together with the fields above. Several values in one field mean "any of these".',
  children,
}: {
  open: boolean;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Modal open={open} title="Additional filters" onClose={onClose} maxWidthClass="max-w-3xl">
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{intro}</p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" className="btn-secondary" onClick={onReset}>
            Reset
          </button>
          <button type="button" className="btn-primary" onClick={onApply}>
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ExpandAllButton({
  anyOpen,
  onClick,
  disabled,
}: {
  anyOpen: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="btn-secondary" onClick={onClick} disabled={disabled}>
      <svg
        className={`h-4 w-4 transition-transform ${anyOpen ? 'rotate-180' : ''}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
      {anyOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );
}

export function RefreshButton({
  onClick,
  spinning,
  title = 'Refresh',
}: {
  onClick: () => void;
  spinning?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <svg
        className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
      </svg>
    </button>
  );
}

/** Row classes for an expandable list row (open, hover, reloading). */
export function expandableRowClass(open: boolean, loading?: boolean) {
  return `group cursor-pointer ${open ? 'bg-slate-50/60' : 'hover:bg-slate-50'} ${loading ? 'opacity-60' : ''}`;
}

/** Classes for the sticky Actions cell of an expandable row. */
export function stickyActionsCellClass(open: boolean) {
  return `sticky right-0 px-4 py-3 text-center shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)] ${
    open ? 'bg-slate-50' : 'bg-white group-hover:bg-slate-50'
  }`;
}

/** The chevron cell that opens and closes one row. */
export function RowExpandCell({
  open,
  onToggle,
  noun,
}: {
  open: boolean;
  onToggle: () => void;
  /** What opens, for screen readers ("lines", "bins", "items"). */
  noun: string;
}) {
  return (
    <td className="px-2 py-3">
      <button
        type="button"
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-expanded={open}
        aria-label={open ? `Collapse ${noun}` : `Expand ${noun}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <svg
          className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </td>
  );
}

/**
 * The opened part of a row: a panel titled "{title} · n" holding a preview of
 * the row's lines, with links to the detail page for whatever was cut off.
 */
export function AccordionPanelRow({
  colSpan,
  title,
  noun,
  total,
  matching,
  filtered,
  shown,
  detailPath,
  children,
}: {
  colSpan: number;
  /** Panel heading, e.g. "Line items". */
  title: string;
  /** Plural noun for the footer, e.g. "lines". */
  noun: string;
  /** Lines on the row in all. */
  total: number;
  /** Lines left after the item filters. */
  matching: number;
  /** An item filter is in force. */
  filtered: boolean;
  /** Lines actually rendered. */
  shown: number;
  detailPath: string;
  children: ReactNode;
}) {
  const hidden = matching - shown;
  const detailLink = (text: string) => (
    <Link to={detailPath} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
      {text}
    </Link>
  );
  return (
    <tr className="bg-slate-50/60">
      <td colSpan={colSpan} className="border-l-4 border-brand-300 px-5 pb-4 pt-1">
        {/* Stays in view while the wide table scrolls sideways. */}
        <div className="sticky left-5 max-w-[calc(100vw-22rem)] overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-600">
            <span>
              {title} {filtered ? `· ${matching} matching of ${total}` : `· ${total}`}
            </span>
            {hidden > 0 && detailLink(`${hidden} more — open detail →`)}
          </div>
          <div className="overflow-x-auto">{children}</div>
          {hidden > 0 && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-[11px] text-slate-500">
              Showing the first {shown} of {matching} {noun} — {detailLink('open the detail page')} to see
              them all.
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function DetailIcon() {
  return (
    <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
