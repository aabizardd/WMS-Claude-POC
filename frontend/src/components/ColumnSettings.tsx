import { useEffect, useMemo, useRef, useState } from 'react';

export interface ColumnOption {
  key: string;
  label: string;
}

/**
 * Which table columns are shown, kept in this browser only (a per-viewer
 * preference). Unknown or missing saved keys fall back to every column.
 */
export function useColumnVisibility(storageKey: string, allKeys: string[]) {
  const [visible, setVisible] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const keep = allKeys.filter((k) => parsed.includes(k));
        if (keep.length) return keep;
      }
    } catch {
      // Storage unavailable: show every column.
    }
    return allKeys;
  });

  function save(next: string[]) {
    const ordered = allKeys.filter((k) => next.includes(k));
    setVisible(ordered);
    try {
      localStorage.setItem(storageKey, JSON.stringify(ordered));
    } catch {
      // Not persisted; still applied for this visit.
    }
  }

  return { visible, setVisible: save };
}

/**
 * "Columns" button: a searchable checklist of the columns, applied on Apply.
 * At least one column stays on.
 */
export default function ColumnSettings({
  columns,
  visible,
  onApply,
}: {
  columns: ColumnOption[];
  visible: string[];
  onApply: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(visible);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return columns.filter((c) => !q || c.label.toLowerCase().includes(q));
  }, [columns, query]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          if (!open) {
            setDraft(visible);
            setQuery('');
          }
          setOpen((o) => !o);
        }}
        aria-expanded={open}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
          <rect x="14" y="14" width="6" height="6" rx="1" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-2 text-sm font-semibold text-slate-800">Column Settings</div>
          <input
            className="input mb-2 py-1.5 text-sm"
            placeholder="Search columns..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {shown.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  checked={draft.includes(c.key)}
                  onChange={() =>
                    setDraft((d) => (d.includes(c.key) ? d.filter((k) => k !== c.key) : [...d, c.key]))
                  }
                />
                {c.label}
              </label>
            ))}
            {shown.length === 0 && (
              <div className="px-1.5 py-2 text-xs text-slate-400">No column matches.</div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
              onClick={() => setDraft(columns.map((c) => c.key))}
            >
              Show all
            </button>
            <button
              type="button"
              className="btn-primary px-3 py-1 text-sm"
              disabled={draft.length === 0}
              title={draft.length === 0 ? 'Keep at least one column' : undefined}
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
