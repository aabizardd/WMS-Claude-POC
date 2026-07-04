import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { DeliveryRow, Paginated } from '../../types';

const LIMIT = 10;

// Closed deliveries (shipped) — read-only history.
export default function HistoryList() {
  const [data, setData] = useState<Paginated<DeliveryRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<DeliveryRow>>('/delivery', {
      params: { page, limit: LIMIT, search: search || undefined, history: true },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-4">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search Delivery / SDO / Packing / SO…"
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
            <thead className="table-head">
              <tr>
                <th className="px-6 py-3">Delivery ID</th>
                <th className="px-6 py-3">SDO ID</th>
                <th className="px-6 py-3">Packing ID</th>
                <th className="px-6 py-3">SO Number</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Location</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {d.delivery_id}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{d.sdo_id ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{d.packing_id ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{d.so_number ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{d.customer ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{d.location ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className="badge bg-emerald-50 text-emerald-700">
                        {d.status}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/outbound/sales-order/history/${d.id}`}
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
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                    No delivery history yet.
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
