import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { Paginated, SalesDeliveryRow, WarehouseOption } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

const SD_STATUS_LABELS: Record<string, string> = {
  Success: 'Success',
  Failed: 'Failed',
};

export function sdStatusLabel(s: string) {
  return SD_STATUS_LABELS[s] ?? s;
}

export function sdStatusBadge(s: string) {
  const map: Record<string, string> = {
    Success: 'bg-emerald-50 text-emerald-700',
    Failed: 'bg-rose-50 text-rose-700',
  };
  return map[s] ?? 'bg-slate-100 text-slate-600';
}

export default function SalesDeliveryListPage() {
  const { has } = useAuth();
  const canCreate = has('sales-delivery:create');

  const [data, setData] = useState<Paginated<SalesDeliveryRow> | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [toWarehouse, setToWarehouse] = useState('');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  useEffect(() => {
    api
      .get<WarehouseOption[]>('/warehouses/options')
      .then((r) => setWarehouses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setWarehouses([]));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Paginated<SalesDeliveryRow>>('/sales-delivery', {
        params: {
          page,
          limit: LIMIT,
          search: search || undefined,
          to_warehouse_id: toWarehouse || undefined,
          ...params(),
        },
      });
      setData(r.data);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, toWarehouse, sort.sortBy, sort.order]);

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
          <Link to="/admin/inventory" className="text-sm text-slate-500 hover:text-slate-700">
            ← Inventory
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-800">
            Inventory Sales Delivery
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `${data.total_data} delivery document(s)` : 'Sales delivery documents'} ·
            stock transfer between the MSO and VHS warehouses.
          </p>
        </div>
        {canCreate && (
          <Link to="/admin/inventory/sales-delivery/new" className="btn-primary">
            + Create Sales Delivery
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          className="input w-56 text-xs"
          value={toWarehouse}
          onChange={(e) => {
            setPage(1);
            setToWarehouse(e.target.value);
          }}
        >
          <option value="">All destinations</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search delivery number…"
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
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="Delivery No." col="delivery_number" sort={sort} onSort={onSort} />
                <SortableTh label="From Location" col="from_warehouse" sort={sort} onSort={onSort} />
                <SortableTh label="To Location" col="to_warehouse" sort={sort} onSort={onSort} />
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Materials</th>
                <th className="px-6 py-3 text-right">Total Qty</th>
                <th className="px-6 py-3">Memo</th>
                <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} />
                <SortableTh label="Created" col="created_at" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {d.delivery_number}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{d.from_warehouse ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{d.to_warehouse ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`badge ${sdStatusBadge(d.status)}`}>
                        {sdStatusLabel(d.status)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right text-slate-600">{d.material_count}</td>
                    <td className="px-6 py-3 text-right font-medium text-slate-800">
                      {d.total_qty}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      <span className="block max-w-[16rem] truncate" title={d.memo ?? ''}>
                        {d.memo ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-600">{d.created_by ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {new Date(d.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/inventory/sales-delivery/${d.id}`}
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
                  <td colSpan={10} className="px-6 py-10 text-center text-slate-400">
                    No sales delivery yet.
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
