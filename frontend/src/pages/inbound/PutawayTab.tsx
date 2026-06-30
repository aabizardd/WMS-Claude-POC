import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { PutawayRow, Paginated } from '../../types';

const LIMIT = 10;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    'OnProgress': 'bg-blue-50 text-blue-700',
    Closed: 'bg-emerald-50 text-emerald-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}

export default function PutawayTab() {
  const [data, setData] = useState<Paginated<PutawayRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<PutawayRow>>('/putaway', {
      params: { page, limit: LIMIT, search: search || undefined },
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
      <p className="text-sm text-slate-500">
        {data ? `${data.total_data} putaways` : 'Putaway'} · generated from Goods
        Receive.
      </p>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search putaway code / GR number…"
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
                <th className="px-6 py-3">Putaway Code</th>
                <th className="px-6 py-3">GR Number</th>
                <th className="px-6 py-3">Warehouse</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Items</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {p.putaway_code}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {p.gr_number ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {p.warehouse_name ?? '—'}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(p.status)}`}
                      >
                        {p.status === 'OnProgress' ? 'On Progress' : p.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {p.item_count}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {p.created_at
                        ? new Date(p.created_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/inbound/putaway/${p.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    No putaways generated yet.
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
