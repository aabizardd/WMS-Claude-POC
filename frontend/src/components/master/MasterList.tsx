import { useEffect, useState, type ReactNode } from 'react';
import api from '../../lib/api';
import type { Paginated } from '../../types';
import { useSort } from '../../hooks/useSort';
import {
  AddButton,
  MasterPager,
  RefreshButton,
  RowMenu,
  SearchBox,
  ToolbarActions,
  type MenuAction,
} from './MasterKit';

export interface MasterColumn<T> {
  label: string;
  /** Backend sort key; columns without one are not sortable. */
  sortKey?: string;
  width?: number;
  render: (row: T) => ReactNode;
}

/**
 * A Master Data list laid out exactly like WMS dev's: search box with the
 * ☰ / refresh / add buttons, a "No"-first table whose Actions column sticks to
 * the right, and the pager. Fetches `endpoint` with page / limit / search /
 * sort; bump `reloadKey` to fetch again after a change made outside it.
 */
export default function MasterList<T extends { id: string | number }>({
  endpoint,
  columns,
  rowActions,
  addLabel,
  onAdd,
  menuActions = [],
  reloadKey = 0,
}: {
  endpoint: string;
  columns: MasterColumn<T>[];
  rowActions?: (row: T) => MenuAction[];
  addLabel?: string;
  onAdd?: () => void;
  menuActions?: MenuAction[];
  reloadKey?: number;
}) {
  const [data, setData] = useState<Paginated<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const { sort, toggle, params } = useSort();

  // Search as you type, like WMS dev, once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<T>>(endpoint, {
        params: { page, limit: pageSize, search: search || undefined, ...params() },
      })
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, page, pageSize, search, sort.sortBy, sort.order, reloadKey, tick]);

  const rows = data?.rows ?? [];
  const hasActions = !!rowActions;
  const colSpan = columns.length + 1 + (hasActions ? 1 : 0);
  const th =
    'border-b border-neutral-100 bg-white font-medium whitespace-nowrap align-middle select-none px-2.5 py-2 text-left dark:border-slate-700 dark:bg-slate-800';
  const td = 'align-middle px-2.5 py-2.5 whitespace-nowrap';
  const sticky = 'sticky right-0 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.08)]';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex w-full items-center">
          <SearchBox value={searchInput} onChange={setSearchInput} />
        </div>
        <div className="flex w-full items-end justify-end gap-2.5">
          {menuActions.length > 0 && <ToolbarActions actions={menuActions} />}
          <RefreshButton onClick={() => setTick((t) => t + 1)} />
          {addLabel && onAdd && <AddButton label={addLabel} onClick={onAdd} />}
        </div>
      </div>

      <div className="w-full space-y-3">
        <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm [mask-image:linear-gradient(white,white)] dark:border-slate-700 dark:bg-slate-800">
          <div className="relative w-full overflow-x-auto [scrollbar-width:thin]">
            <table className="table w-full border-separate border-spacing-0 [table-layout:auto] [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:rounded-tl-lg [&_th:first-child]:pl-6 [&_th:last-child]:rounded-tr-lg [&_th:last-child]:pr-6">
              <thead className="text-sm text-neutral-600 dark:text-slate-400">
                <tr className="bg-white dark:bg-slate-800">
                  <th className={th} style={{ width: 70, minWidth: 70 }}>
                    <div className="flex items-center gap-1">No</div>
                  </th>
                  {columns.map((c) => {
                    const active = c.sortKey && sort.sortBy === c.sortKey;
                    return (
                      <th
                        key={c.label}
                        className={`${th} ${c.sortKey ? 'cursor-pointer hover:text-neutral-900 dark:hover:text-white' : ''}`}
                        style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                        aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
                        onClick={
                          c.sortKey
                            ? () => {
                                setPage(1);
                                toggle(c.sortKey!);
                              }
                            : undefined
                        }
                      >
                        <div className="flex items-center gap-1">
                          {c.label}
                          {active && <span className="text-[10px]">{sort.order === 'asc' ? '▲' : '▼'}</span>}
                        </div>
                      </th>
                    );
                  })}
                  {hasActions && (
                    <th className={`${th} ${sticky} z-20`} style={{ width: 80, minWidth: 80 }}>
                      <div className="flex w-full items-center justify-center gap-1">Actions</div>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="text-sm text-neutral-800 dark:text-slate-200">
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-2.5 py-10 text-center text-sm text-neutral-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-2.5 py-10 text-center text-sm text-neutral-500">
                      No data found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr
                      key={row.id}
                      className={`group border-b border-neutral-100 bg-white last:border-b-0 hover:bg-neutral-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50 ${
                        loading ? 'opacity-60' : ''
                      }`}
                    >
                      <td className={`${td} text-sm text-neutral-900 dark:text-slate-100`}>
                        {(page - 1) * pageSize + i + 1}
                      </td>
                      {columns.map((c) => (
                        <td key={c.label} className={td}>
                          {c.render(row)}
                        </td>
                      ))}
                      {hasActions && (
                        <td
                          className={`${td} ${sticky} z-10 bg-white transition-[background-color,box-shadow] duration-200 ease-in-out group-hover:bg-neutral-50 dark:bg-slate-800 dark:group-hover:bg-slate-700`}
                        >
                          {(() => {
                            const actions = rowActions!(row);
                            return actions.length > 0 ? <RowMenu actions={actions} /> : null;
                          })()}
                        </td>
                      )}
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
          total={data?.total_data ?? 0}
          onPage={setPage}
          onPageSize={(n) => {
            setPage(1);
            setPageSize(n);
          }}
        />
      </div>
    </div>
  );
}
