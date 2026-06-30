import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Bin, Paginated } from '../../types';
import { useAuth } from '../../context/AuthContext';

const LIMIT = 10;

export default function BinsPage() {
  const { has } = useAuth();
  const canCreate = has('bins:create');
  const canUpdate = has('bins:update');
  const canDelete = has('bins:delete');

  const [data, setData] = useState<Paginated<Bin> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<Bin>>('/bins', {
      params: { page, limit: LIMIT, search: search || undefined },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  async function handleDelete(b: Bin) {
    if (!confirm(`Delete bin "${b.bin_label}"?`)) return;
    try {
      await api.delete(`/bins/${b.id}`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err))
        alert(err.response?.data?.message ?? 'Delete failed');
    }
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Bins</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `${data.total_data} bins` : 'Storage bins'} across warehouses.
          </p>
        </div>
        {canCreate && (
          <Link to="/admin/bins/new" className="btn-primary">
            + Add Bin
          </Link>
        )}
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search bin label / code…"
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
                <th className="px-6 py-3">Bin Label</th>
                <th className="px-6 py-3">Warehouse</th>
                <th className="px-6 py-3">Aisle</th>
                <th className="px-6 py-3">Shelf</th>
                <th className="px-6 py-3">Area Type</th>
                <th className="px-6 py-3">L×W×H</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
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
                data.rows.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {b.bin_label}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {b.warehouse_name?.warehouse_name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {b.aisle?.aisle_name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {b.shelf?.shelf_label ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {b.warehouse_area_type?.area_type_name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {b.bin_length}×{b.bin_width}×{b.bin_height}
                      {b.dimension_uom?.uom_code
                        ? ` ${b.dimension_uom.uom_code}`
                        : ''}
                    </td>
                    <td className="px-6 py-3">
                      {b.is_active ? (
                        <span className="text-xs font-medium text-emerald-600">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-400">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/admin/bins/${b.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          {canUpdate ? 'Edit' : 'View'}
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(b)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                    No bins found.
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
