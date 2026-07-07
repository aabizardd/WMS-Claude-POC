import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { InventoryAdjustmentRow, Paginated } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

export function adjTypeLabel(t: string) {
  return t === 'qty_issue' ? 'Qty Issue' : t === 'quality_issue' ? 'Quality Issue' : t;
}
export function adjStatusLabel(s: string) {
  if (s === 'PendingApproval') return 'Pending Approval WH Manager';
  if (s === 'Approved') return 'Approved by Manager Warehouse';
  if (s === 'Rejected') return 'Rejected';
  return s;
}
export function adjStatusBadge(s: string) {
  const map: Record<string, string> = {
    PendingApproval: 'bg-amber-50 text-amber-700',
    Approved: 'bg-emerald-50 text-emerald-700',
    Rejected: 'bg-rose-50 text-rose-700',
  };
  return map[s] ?? 'bg-slate-100 text-slate-600';
}
function statusBadge(s: string) {
  const map: Record<string, string> = {
    PendingApproval: 'bg-amber-50 text-amber-700',
    Approved: 'bg-emerald-50 text-emerald-700',
    Rejected: 'bg-rose-50 text-rose-700',
  };
  return map[s] ?? 'bg-slate-100 text-slate-600';
}

const TYPE_TABS = [
  { v: '', l: 'All' },
  { v: 'qty_issue', l: 'Qty Issue' },
  { v: 'quality_issue', l: 'Quality Issue' },
];

export default function InventoryAdjustmentsPage() {
  const { has } = useAuth();
  const canCreate = has('inventory-adjustments:create');

  const [data, setData] = useState<Paginated<InventoryAdjustmentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [type, setType] = useState('');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<InventoryAdjustmentRow>>('/inventory-adjustments', {
      params: {
        page,
        limit: LIMIT,
        search: search || undefined,
        adjustment_type: type || undefined,
        ...params(),
      },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, type, sort.sortBy, sort.order]);

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
          <h1 className="text-2xl font-semibold text-slate-800">Inventory Adjustment</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `${data.total_data} adjustment(s)` : 'Inventory adjustments'} · qty / quality issue.
          </p>
        </div>
        {canCreate && (
          <Link to="/admin/inventory-adjustments/new" className="btn-primary">
            + Create Adjustment
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
          {TYPE_TABS.map((t) => (
            <button
              key={t.v || 'all'}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                type === t.v ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
              onClick={() => {
                setPage(1);
                setType(t.v);
              }}
            >
              {t.l}
            </button>
          ))}
        </div>
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search adjustment number…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn-secondary">Search</button>
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
                <SortableTh label="Adjustment No." col="adjustment_number" sort={sort} onSort={onSort} />
                <SortableTh label="Warehouse" col="warehouse" sort={sort} onSort={onSort} />
                <SortableTh label="Type" col="adjustment_type" sort={sort} onSort={onSort} />
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Materials</th>
                <th className="px-6 py-3 text-right">Bins</th>
                <th className="px-6 py-3 text-right">Total Qty</th>
                <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} />
                <SortableTh label="Created" col="created_at" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-slate-400">Loading…</td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">{a.adjustment_number}</td>
                    <td className="px-6 py-3 text-slate-600">{a.warehouse ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{adjTypeLabel(a.adjustment_type)}</td>
                    <td className="px-6 py-3">
                      <span className={`badge ${statusBadge(a.status)}`}>{adjStatusLabel(a.status)}</span>
                    </td>
                    <td className="px-6 py-3 text-right text-slate-600">{a.material_count}</td>
                    <td className="px-6 py-3 text-right text-slate-600">{a.bin_count}</td>
                    <td className="px-6 py-3 text-right font-medium text-slate-800">{a.total_qty}</td>
                    <td className="px-6 py-3 text-slate-600">{a.created_by ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/inventory-adjustments/${a.id}`}
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
                  <td colSpan={10} className="px-6 py-10 text-center text-slate-400">No adjustments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPage > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm">
            <span className="text-slate-500">Page {page} of {totalPage}</span>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
              <button className="btn-secondary" disabled={page >= totalPage} onClick={() => setPage((p) => Math.min(totalPage, p + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
