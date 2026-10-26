import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SalesDeliveryRow } from '../../types';
import type { SortState } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

/**
 * The Inventory Sales list table columns: No, Status, SD Number, Origin, Destination,
 * Department, Class, Customer, Total Materials, Total Qty, Memo, Created By,
 * Created At (Actions is added by each page).
 */

export type SalesColumnKey =
  | 'status'
  | 'number'
  | 'origin'
  | 'destination'
  | 'department'
  | 'class'
  | 'customer'
  | 'total_materials'
  | 'total_qty'
  | 'memo'
  | 'created_by'
  | 'created_at';

interface SalesColumn {
  key: SalesColumnKey;
  /** isReturn: true = only returns shown, false = only deliveries, null = a mix. */
  label: (isReturn: boolean | null) => string;
  /** Server sort key; absent for aggregates the server cannot order by. */
  sortCol?: string;
  align?: 'right';
  cell: (d: SalesDeliveryRow) => ReactNode;
}

const STATUS_BADGE: Record<string, string> = {
  Success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Failed: 'bg-rose-50 text-rose-700 ring-rose-200',
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const SALES_COLUMNS: SalesColumn[] = [
  {
    key: 'status',
    label: () => 'Status',
    sortCol: 'status',
    cell: (d) => (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
          STATUS_BADGE[d.status] ?? 'bg-slate-100 text-slate-600 ring-slate-200'
        }`}
      >
        {d.status}
      </span>
    ),
  },
  {
    key: 'number',
    label: (isReturn) =>
      isReturn === null ? 'SD/SR Number' : isReturn ? 'SR Number' : 'SD Number',
    sortCol: 'delivery_number',
    cell: (d) => (
      <div>
        <div className="font-medium text-slate-800">{d.delivery_number}</div>
        {d.source_delivery_number && (
          <div className="text-[11px] text-slate-400">reverses {d.source_delivery_number}</div>
        )}
      </div>
    ),
  },
  {
    key: 'origin',
    label: () => 'Origin Location',
    sortCol: 'from_warehouse',
    cell: (d) => d.from_warehouse ?? '-',
  },
  {
    key: 'destination',
    label: () => 'Destination Location',
    sortCol: 'to_warehouse',
    cell: (d) => d.to_warehouse ?? '-',
  },
  { key: 'department', label: () => 'Department', sortCol: 'department', cell: (d) => d.department ?? '-' },
  { key: 'class', label: () => 'Class', sortCol: 'class', cell: (d) => d.class ?? '-' },
  { key: 'customer', label: () => 'Customer', sortCol: 'customer', cell: (d) => d.customer ?? '-' },
  {
    key: 'total_materials',
    label: () => 'Total Materials',
    align: 'right',
    cell: (d) => d.material_count.toLocaleString(),
  },
  {
    key: 'total_qty',
    label: () => 'Total Qty',
    align: 'right',
    cell: (d) => <span className="font-medium text-slate-800">{d.total_qty.toLocaleString()}</span>,
  },
  {
    key: 'memo',
    label: () => 'Memo',
    cell: (d) => (
      <span className="block max-w-[16rem] truncate" title={d.memo ?? ''}>
        {d.memo ?? '-'}
      </span>
    ),
  },
  { key: 'created_by', label: () => 'Created By', sortCol: 'created_by', cell: (d) => d.created_by ?? '-' },
  {
    key: 'created_at',
    label: () => 'Created At',
    sortCol: 'created_at',
    cell: (d) => formatDateTime(d.created_at),
  },
];

/** Header cells for the visible columns, after the page's own leading cells. */
export function SalesHeaderCells({
  visible,
  isReturn,
  sort,
  onSort,
}: {
  visible: SalesColumnKey[];
  isReturn: boolean | null;
  sort: SortState;
  onSort: (col: string) => void;
}) {
  return (
    <>
      {SALES_COLUMNS.filter((c) => visible.includes(c.key)).map((c) =>
        c.sortCol ? (
          <SortableTh
            key={c.key}
            label={c.label(isReturn)}
            col={c.sortCol}
            sort={sort}
            onSort={onSort}
            pad="px-4"
            align={c.align}
            className="whitespace-nowrap"
          />
        ) : (
          <th
            key={c.key}
            className={`whitespace-nowrap px-4 py-3 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
          >
            {c.label(isReturn)}
          </th>
        ),
      )}
    </>
  );
}

/** Body cells for one row, matching SalesHeaderCells. */
export function SalesRowCells({
  row,
  visible,
}: {
  row: SalesDeliveryRow;
  visible: SalesColumnKey[];
}) {
  return (
    <>
      {SALES_COLUMNS.filter((c) => visible.includes(c.key)).map((c) => (
        <td
          key={c.key}
          className={`whitespace-nowrap px-4 py-3 text-slate-600 ${c.align === 'right' ? 'text-right' : ''}`}
        >
          {c.cell(row)}
        </td>
      ))}
    </>
  );
}

const ALL_KEYS = SALES_COLUMNS.map((c) => c.key);
const STORAGE_KEY = 'wms.inventorySales.columns';

/**
 * Which columns are shown. Kept in this browser only (a per-viewer
 * preference).
 */
export function useSalesColumns() {
  const [visible, setVisible] = useState<SalesColumnKey[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const keep = ALL_KEYS.filter((k) => parsed.includes(k));
        if (keep.length) return keep;
      }
    } catch {
      // Storage unavailable: fall back to every column.
    }
    return ALL_KEYS;
  });

  function save(next: SalesColumnKey[]) {
    const ordered = ALL_KEYS.filter((k) => next.includes(k));
    setVisible(ordered);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
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
export function ColumnSettings({
  visible,
  onApply,
  isReturn,
}: {
  visible: SalesColumnKey[];
  onApply: (keys: SalesColumnKey[]) => void;
  isReturn: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SalesColumnKey[]>(visible);
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
    return SALES_COLUMNS.filter((c) => !q || c.label(isReturn).toLowerCase().includes(q));
  }, [query, isReturn]);

  function toggle(key: SalesColumnKey) {
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  }

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
                  onChange={() => toggle(c.key)}
                />
                {c.label(isReturn)}
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
              onClick={() => setDraft(ALL_KEYS)}
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
