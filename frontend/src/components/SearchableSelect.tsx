import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

const PAGE = 10;

// Reusable searchable select: filter by text, render 10 at a time, and lazily
// reveal more on scroll (infinite scroll). The dropdown is rendered in a portal
// with fixed positioning so it never gets clipped by tables/modals overflow.
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled = false,
  emptyText = 'No results',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);

  useEffect(() => {
    setVisible(PAGE);
  }, [search, open]);

  function reposition() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onMove() {
      reposition();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  function onScroll(e: React.UIEvent<HTMLUListElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      setVisible((v) => Math.min(v + PAGE, filtered.length));
    }
  }

  const shown = filtered.slice(0, visible);

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        <span className={selected ? 'truncate text-slate-800 dark:text-slate-100' : 'truncate text-slate-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && rect &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 200 }}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl animate-[fadeIn_0.12s_ease-out] dark:border-slate-600 dark:bg-slate-800"
          >
            <div className="border-b border-slate-100 p-2 dark:border-slate-700">
              <input
                autoFocus
                className="input w-full text-sm"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul className="max-h-60 overflow-y-auto py-1" onScroll={onScroll}>
              {shown.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-slate-400">{emptyText}</li>
              ) : (
                shown.map((o) => (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                        o.value === value ? 'font-medium text-brand-700 dark:text-brand-400' : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="truncate">{o.label}</span>
                      {o.value === value && (
                        <svg className="h-4 w-4 flex-shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </li>
                ))
              )}
              {visible < filtered.length && (
                <li className="px-3 py-2 text-center text-xs text-slate-400">
                  Scroll for more… ({filtered.length - visible})
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
