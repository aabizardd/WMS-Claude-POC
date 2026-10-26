import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/*
 * The building blocks of a Master Data list, copied from WMS dev's markup and
 * Tailwind classes so the two apps look the same: search box, ☰ / refresh /
 * add buttons, a white bordered table, status pills, the ⋮ row menu and the
 * "Showing 10 · 1-10 of 47 · Previous 1 2 … 5 Next" pager.
 */

const BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg h-[34px] text-sm font-medium tracking-wide transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50';
const ICON_BTN = `${BTN} border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 w-[34px] h-[34px] p-0 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`;
const MENU =
  'fixed z-50 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg min-w-[7rem] dark:border-slate-700 dark:bg-slate-800';
const MENU_ITEM =
  'flex w-full items-center gap-2 pl-3 pr-10 py-2 text-left text-sm whitespace-nowrap hover:bg-neutral-50 dark:hover:bg-slate-700';

/** A lucide icon (24×24, stroke 2), as WMS dev uses everywhere. */
export function Lucide({ children, className = 'h-4 w-4' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const icons = {
  search: (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  menu: <path d="M4 12h16M4 18h16M4 6h16" />,
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  ellipsisVertical: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  pencil: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  cloudSync: (
    <>
      <path d="M12 13v8l-4-4M12 21l4-4" />
      <path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" />
    </>
  ),
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
};

/** "2026-10-09 16:34", as WMS dev prints dates in its tables. */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A table cell's text, with WMS dev's "-" for empty values. */
export function Cell({ children }: { children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return <span className="text-sm text-neutral-900 dark:text-slate-100">{empty ? '-' : children}</span>;
}

export function StatusPill({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  const label = active ? activeLabel : inactiveLabel;
  return (
    <span
      title={label}
      className={`inline-flex w-[130px] items-center justify-center rounded-full py-1 text-center text-[12px] font-medium ring-1 ${
        active
          ? 'bg-[#EFFAF4] text-[#2E8F5C] ring-[#2E8F5C]'
          : 'bg-[#FEF2F2] text-[#B91C1C] ring-[#B91C1C]'
      }`}
    >
      <span className="truncate px-2">{label}</span>
    </span>
  );
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

/** A button whose menu opens under it, against the viewport (never clipped). */
function MenuButton({
  actions,
  buttonClass,
  icon,
  label,
}: {
  actions: MenuAction[];
  buttonClass: string;
  icon: ReactNode;
  label: string;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [pos]);

  function toggle() {
    if (pos) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }

  return (
    <div className="relative">
      <button ref={btnRef} type="button" className={buttonClass} onClick={toggle} title={label} aria-label={label}>
        <Lucide>{icon}</Lucide>
      </button>
      {pos &&
        createPortal(
          <div ref={menuRef} style={{ top: pos.top, right: pos.right }} className={MENU}>
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`${MENU_ITEM} text-black dark:text-slate-200`}
                onClick={() => {
                  setPos(null);
                  a.onClick();
                }}
              >
                {a.icon && <Lucide>{a.icon}</Lucide>}
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The ☰ "Actions" button of the toolbar. */
export function ToolbarActions({ actions }: { actions: MenuAction[] }) {
  return <MenuButton actions={actions} buttonClass={ICON_BTN} icon={icons.menu} label="Actions" />;
}

/** The ⋮ button at the end of a row. */
export function RowMenu({ actions }: { actions: MenuAction[] }) {
  return (
    <div className="flex justify-center">
      <MenuButton
        actions={actions}
        buttonClass={`${ICON_BTN} !h-8 !w-8 !p-0`}
        icon={icons.ellipsisVertical}
        label="Row actions"
      />
    </div>
  );
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={ICON_BTN} onClick={onClick} title="Refresh" aria-label="Refresh">
      <Lucide>{icons.refresh}</Lucide>
    </button>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${BTN} border border-[#5166AE] bg-white px-3.5 text-[#5166AE] shadow-sm hover:bg-[#F2F4FD] dark:bg-slate-800 dark:text-[#aab6e8] dark:hover:bg-slate-700`}
    >
      <Lucide>{icons.plus}</Lucide>
      {label}
    </button>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative shrink-0" style={{ width: 320, maxWidth: 400 }}>
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {icons.search}
        </svg>
      </div>
      <input
        placeholder="Search..."
        className="w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-black outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        style={{ height: 34 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function MasterPager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const navBtn = (disabled: boolean) =>
    `flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${
      disabled
        ? 'cursor-not-allowed text-neutral-300 dark:text-slate-600'
        : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 dark:text-slate-300 dark:hover:bg-slate-700'
    }`;

  return (
    <div className="no-print mt-8 flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
      <div className="flex items-center gap-2">
        <span>Showing</span>
        <select
          className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[11px] text-neutral-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {[5, 10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span>
          {start}-{end}
        </span>
        <span>of</span>
        <span className="text-neutral-800 dark:text-slate-100">{total}</span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} className={navBtn(page <= 1)} onClick={() => onPage(page - 1)}>
          <Lucide className="h-3.5 w-3.5">{icons.chevronLeft}</Lucide>
          <span>Previous</span>
        </button>
        {pageItems(page, pageCount).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-1 text-neutral-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              className={`h-7 rounded-md px-2 text-[11px] ${
                p === page
                  ? 'border border-neutral-300 bg-white text-neutral-900 shadow-sm dark:border-slate-500 dark:bg-slate-700 dark:text-white'
                  : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= pageCount}
          className={navBtn(page >= pageCount)}
          onClick={() => onPage(page + 1)}
        >
          <span>Next</span>
          <Lucide className="h-3.5 w-3.5">{icons.chevronRight}</Lucide>
        </button>
      </div>
    </div>
  );
}

/** WMS dev's pages: 1, 2, …, last — plus the neighbours of the current one. */
function pageItems(page: number, count: number): (number | '…')[] {
  if (count <= 3) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, 2, count, page - 1, page, page + 1]);
  const out: (number | '…')[] = [];
  for (let p = 1; p <= count; p++) {
    if (keep.has(p)) out.push(p);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}
