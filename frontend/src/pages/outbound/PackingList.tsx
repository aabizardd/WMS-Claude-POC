import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { Paginated, PackingRow } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    Closed: 'bg-emerald-50 text-emerald-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}

// Packing documents generated from Closed pickings.
export default function PackingList() {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canDeliver = has('delivery:create');

  const [data, setData] = useState<Paginated<PackingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { sort, toggle: toggleSort, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggleSort(col);
  };

  // Selection mode (Generate Delivery).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<PackingRow>>('/packing', {
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

  const rows = data?.rows ?? [];
  // Only Closed packings can be delivered.
  const selectableRows = rows.filter((r) => r.status === 'Closed');
  const allSelectedOnPage =
    selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));

  function enterSelection() {
    setSelectionMode(true);
    setSelected(new Set());
  }
  function cancelSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) selectableRows.forEach((r) => next.delete(r.id));
      else selectableRows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function handleGenerate() {
    if (selected.size === 0) {
      toast.error('Select at least one packing');
      return;
    }
    const ok = await confirm({
      title: 'Generate Delivery?',
      description: `${selected.size} packing document(s) will be delivered. Delivered packings move to the Delivery List.`,
      type: 'info',
      confirmText: 'Generate',
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await api.post<{ created: number }>('/delivery/generate', {
        packingIds: [...selected],
      });
      toast.success(`${r.data.created} delivery document(s) created`);
      cancelSelection();
      setPage(1);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Generate failed');
      } else toast.error('Generate failed');
    } finally {
      setGenerating(false);
    }
  }

  const totalPage = data?.total_page ?? 0;
  const colCount = selectionMode ? 8 : 7;
  const shown = useMemo(() => rows, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search Packing / Picking / SO number…"
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

        {canDeliver &&
          (selectionMode ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">{selected.size} selected</span>
              <button
                className="btn-secondary"
                onClick={cancelSelection}
                disabled={generating}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleGenerate}
                disabled={generating || selected.size === 0}
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={enterSelection}>
              Generate Delivery
            </button>
          ))}
      </div>

      {selectionMode && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-700">
          Selection mode: choose one or more packing documents to deliver.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="table-head">
              <tr>
                {selectionMode && (
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={allSelectedOnPage}
                      onChange={toggleAllOnPage}
                      aria-label="Select all on page"
                    />
                  </th>
                )}
                <SortableTh label="Packing ID" col="packing_code" sort={sort} onSort={onSort} />
                <SortableTh label="Picking ID" col="picking_id" sort={sort} onSort={onSort} />
                <SortableTh label="SO Number" col="so_number" sort={sort} onSort={onSort} />
                <SortableTh label="Location" col="location" sort={sort} onSort={onSort} />
                <SortableTh label="Customer" col="customer" sort={sort} onSort={onSort} />
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : shown.length > 0 ? (
                shown.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-slate-50 ${
                      selectionMode && selected.has(p.id) ? 'bg-brand-50/50' : ''
                    }`}
                  >
                    {selectionMode && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                          checked={selected.has(p.id)}
                          disabled={p.status !== 'Closed'}
                          title={p.status !== 'Closed' ? 'Only Closed packings can be delivered' : undefined}
                          onChange={() => toggle(p.id)}
                        />
                      </td>
                    )}
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {p.packing_id}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{p.picking_id ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{p.so_number ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{p.location ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{p.customer ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`badge ${statusBadge(p.status)}`}>{p.status}</span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/outbound/sales-order/packing/${p.id}`}
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
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    No packing documents yet.
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
