import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { InventoryAdjustmentItemRow, Paginated } from '../../types';
import TablePager from '../../components/TablePager';
import { useSort } from '../../hooks/useSort';
import { AdjLinesTable } from './iaShared';

/** Wait this long after the last keystroke before searching. */
const SEARCH_DELAY_MS = 350;

/**
 * The detail's Adjustment Bins tab. Lines are searched, filtered, sorted and
 * paged by the server (GET /inventory-adjustments/:id/items), so a document
 * with hundreds of lines only ever loads one page.
 */
export default function AdjBinsPanel({
  adjustmentId,
  qualityMode,
  warehouses,
  reloadKey,
}: {
  adjustmentId: string;
  qualityMode: boolean;
  /** The warehouses the document's lines span (the filter offers them when more than one). */
  warehouses: { id: string | null; name: string | null }[];
  /** Bumped by the page's Refresh / actions so the open page reloads too. */
  reloadKey: number;
}) {
  const [data, setData] = useState<Paginated<InventoryAdjustmentItemRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [qtySign, setQtySign] = useState('');
  const { sort, toggle, params } = useSort();

  // Search after typing pauses, back on page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<InventoryAdjustmentItemRow>>(`/inventory-adjustments/${adjustmentId}/items`, {
        params: {
          page,
          limit: pageSize,
          search: search || undefined,
          warehouse_id: warehouseId || undefined,
          qty_sign: qtySign || undefined,
          ...params(),
        },
      })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        setError('');
      })
      .catch(() => !cancelled && setError('Failed to load the adjustment lines.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustmentId, page, pageSize, search, warehouseId, qtySign, sort.sortBy, sort.order, reloadKey]);

  const filtered = !!(search || warehouseId || qtySign);
  const rows = data?.rows ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="relative w-full max-w-xs">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            className="input pl-9"
            placeholder="Search material or bin…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label="Search material or bin"
          />
        </div>
        {warehouses.length > 1 && (
          <select
            className="input w-auto"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setPage(1);
            }}
            aria-label="Warehouse"
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id ?? ''} value={w.id ?? ''}>
                {w.name ?? '-'}
              </option>
            ))}
          </select>
        )}
        <select
          className="input w-auto"
          value={qtySign}
          onChange={(e) => {
            setQtySign(e.target.value);
            setPage(1);
          }}
          aria-label="Adjustment direction"
        >
          <option value="">All adjustments</option>
          <option value="positive">{qualityMode ? 'With Qty Passed' : 'Increase (+)'}</option>
          <option value="negative">{qualityMode ? 'Negative Qty Passed' : 'Decrease (−)'}</option>
        </select>
        {loading && <span className="text-xs text-neutral-400">Loading…</span>}
      </div>

      {error ? (
        <div className="px-4 py-8 text-center text-sm text-red-600">{error}</div>
      ) : (
        <div className={`overflow-x-auto ${loading && data ? 'opacity-60' : ''}`}>
          <AdjLinesTable
            lines={rows}
            qualityMode={qualityMode}
            startNo={(page - 1) * pageSize + 1}
            emptyText={loading && !data ? 'Loading…' : filtered ? 'No line matches the search or filters.' : 'This adjustment has no lines.'}
            sort={{
              state: sort,
              onSort: (col) => {
                setPage(1);
                toggle(col);
              },
            }}
          />
        </div>
      )}

      <TablePager
        page={page}
        pageSize={pageSize}
        total={data?.total_data ?? 0}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </div>
  );
}
