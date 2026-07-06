import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { GoodsReceiveRow, Paginated } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { grStatusBadgeClass, grStatusLabel } from '../../lib/grStatus';

const LIMIT = 10;

function statusBadge(status: string) {
  const base = grStatusBadgeClass(status);
  return status === 'Syncing' ? `${base} animate-pulse` : base;
}

export default function GoodsReceiveTab() {
  const { has } = useAuth();
  const canUpdate = has('goods-receive:update');

  const [data, setData] = useState<Paginated<GoodsReceiveRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<GoodsReceiveRow>>('/goods-receive', {
      params: { page, limit: LIMIT, search: search || undefined },
    });
    setData(r.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  useEffect(() => {
    const onStatusChanged = () => load();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };

    window.addEventListener('gr-status-changed', onStatusChanged);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('gr-status-changed', onStatusChanged);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {data ? `${data.total_data} documents` : 'Goods Receive'} · fill the actual
        received quantity per item.
      </p>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search GR / shipment number…"
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
                <th className="px-6 py-3">GR Number</th>
                <th className="px-6 py-3">Shipment No.</th>
                <th className="px-6 py-3">Receiving Location</th>
                <th className="px-6 py-3">Items</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {g.gr_number}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {g.shipment_number ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {g.receiving_location_name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{g.item_count}</td>
                    <td className="px-6 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(
                          g.status,
                        )}`}
                      >
                          {grStatusLabel(g.status)}
                          {g.status === 'Syncing' && '…'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/inbound/pib/goods-receive/${g.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          {canUpdate ? 'Receive' : 'View'}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                    No Goods Receive documents yet.
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
