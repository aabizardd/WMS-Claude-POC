import type { ReactNode } from 'react';
import type { SortState } from '../hooks/useSort';

interface Props {
  label: ReactNode;
  col: string; // backend column key (snake_case)
  sort: SortState;
  onSort: (col: string) => void;
  align?: 'left' | 'right' | 'center';
  pad?: string; // horizontal padding utility (default px-6)
  className?: string;
}

// A clickable table header that cycles asc → desc → default and shows an arrow
// indicator on the active column. Use for sortable data columns only (never the
// Action column).
export default function SortableTh({
  label,
  col,
  sort,
  onSort,
  align = 'left',
  pad = 'px-6',
  className = '',
}: Props) {
  const active = sort.sortBy === col;
  const justify =
    align === 'right'
      ? 'justify-end'
      : align === 'center'
        ? 'justify-center'
        : 'justify-start';

  return (
    <th className={`${pad} py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`group inline-flex items-center gap-1 ${justify} font-inherit uppercase tracking-wide transition hover:text-slate-700 dark:hover:text-slate-200 ${
          active ? 'text-slate-700 dark:text-slate-200' : ''
        }`}
        title="Sort"
      >
        <span>{label}</span>
        <Arrow active={active} order={sort.order} />
      </button>
    </th>
  );
}

function Arrow({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active) {
    // Neutral (faint) indicator shown on hover to hint sortability.
    return (
      <svg
        className="h-3 w-3 flex-shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
      </svg>
    );
  }
  return (
    <svg
      className="h-3 w-3 flex-shrink-0 text-brand-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      {order === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      )}
    </svg>
  );
}
