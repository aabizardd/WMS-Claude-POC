import { useState } from 'react';

export type SortOrder = 'asc' | 'desc';

export interface SortState {
  // Backend column key (snake_case), or null for the endpoint's default order.
  sortBy: string | null;
  order: SortOrder;
}

const DEFAULT: SortState = { sortBy: null, order: 'asc' };

// Three-click sort cycle per column: none → asc → desc → none (default).
export function useSort(initial: SortState = DEFAULT) {
  const [sort, setSort] = useState<SortState>(initial);

  function toggle(col: string) {
    setSort((s) => {
      if (s.sortBy !== col) return { sortBy: col, order: 'asc' };
      if (s.order === 'asc') return { sortBy: col, order: 'desc' };
      return { ...DEFAULT }; // third click → back to default
    });
  }

  // Query params for a paginated (server-side) endpoint.
  function params(): { sort_by?: string; sort_order?: SortOrder } {
    return sort.sortBy
      ? { sort_by: sort.sortBy, sort_order: sort.order }
      : {};
  }

  return { sort, toggle, setSort, params };
}

// Client-side comparator for non-paginated lists. `get` maps a row to its
// comparable value for the active column.
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  get: (row: T, col: string) => string | number | null | undefined,
): T[] {
  if (!sort.sortBy) return rows;
  const col = sort.sortBy;
  const dir = sort.order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a, col);
    const bv = get(b, col);
    // Nulls always sort last regardless of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
}
