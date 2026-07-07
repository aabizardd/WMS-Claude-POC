import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { InventoryRow, Paginated } from '../../types';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

export default function InventoryPage() {
  const [data, setData] = useState<Paginated<InventoryRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<InventoryRow>>('/inventory', {
      params: { page, limit: LIMIT, search: search || undefined, ...params() },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, sort.sortBy, sort.order]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">
          Inventory Management
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {data ? `${data.total_data} materials` : 'Inventory'} on hand · one row
          per material per warehouse (sum of its batches).
        </p>
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search material code / name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {search && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear
          </button>
        )}
      </form>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="Material" col="material_code" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="Type" col="material_type" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="Category" col="material_category" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="UoM" col="primary_uom" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="Warehouse" col="warehouse_name" sort={sort} onSort={onSort} pad="px-5" />
                <th className="px-5 py-3 text-right">On Hand</th>
                <th className="px-5 py-3 text-right">Reserved</th>
                <th className="px-5 py-3 text-right">Avail</th>
                <th className="px-5 py-3 text-right">In Transit</th>
                <th className="px-5 py-3 text-right">Qlty Issue</th>
                <th className="px-5 py-3 text-right">Qty Issue</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-5 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-800">
                        {r.material_name ?? '—'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {r.material_code}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.material_type ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.material_category ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.primary_uom ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.warehouse_name ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">
                      {r.on_hand}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.reserved_qty}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.avail_qty}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.in_transit_qty}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.quality_issue}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.qty_issue}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/inventory/${r.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          Detail
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="px-5 py-10 text-center text-slate-400">
                    No inventory yet. It is generated when a Goods Receive is
                    received.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPage > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {totalPage}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                className="btn-secondary"
                disabled={page >= totalPage}
                onClick={() => setPage((p) => Math.min(totalPage, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
