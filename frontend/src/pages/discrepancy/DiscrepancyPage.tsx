import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import type { DiscrepancyRow, Paginated } from '../../types';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

function typeBadge(type: string) {
  const map: Record<string, string> = {
    quantity: 'bg-amber-50 text-amber-700',
    quality: 'bg-purple-50 text-purple-700',
  };
  return map[type] ?? 'bg-slate-100 text-slate-600';
}

function fromBadge(from: string) {
  const map: Record<string, string> = {
    inbound: 'bg-sky-50 text-sky-700',
    outbound: 'bg-orange-50 text-orange-700',
  };
  return map[from] ?? 'bg-slate-100 text-slate-600';
}

export default function DiscrepancyPage() {
  const [data, setData] = useState<Paginated<DiscrepancyRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('quantity');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<DiscrepancyRow>>('/discrepancy', {
      params: {
        page,
        limit: LIMIT,
        search: search || undefined,
        type: typeFilter || undefined,
        ...params(),
      },
    });
    setData(r.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, typeFilter, sort.sortBy, sort.order]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPage = data?.total_page ?? 0;

  // Group (within the current page): outbound discrepancies that carry a Sales
  // Order number are grouped per SO; inbound (no SO) render in a separate group.
  const rows = data?.rows ?? [];
  const withSo = rows
    .filter((r) => r.so_number)
    .sort((a, b) => (a.so_number ?? '').localeCompare(b.so_number ?? ''));
  const withoutSo = rows.filter((r) => !r.so_number);

  const groupHeader = (label: string) => (
    <tr className="bg-brand-50/50">
      <td
        colSpan={9}
        className="px-6 py-2 text-xs font-semibold uppercase tracking-wide text-brand-700"
      >
        {label}
      </td>
    </tr>
  );

  const discRow = (d: DiscrepancyRow) => (
    <tr key={d.id} className="hover:bg-slate-50">
      <td className="px-6 py-3 font-medium text-slate-800">{d.discrepancy_id}</td>
      <td className="px-6 py-3 text-slate-600">{d.source_number ?? '—'}</td>
      <td className="px-6 py-3 text-slate-600">{d.source ?? '—'}</td>
      <td className="px-6 py-3">
        <span
          className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${typeBadge(
            d.discrepancy_type,
          )}`}
        >
          {d.discrepancy_type}
        </span>
      </td>
      <td className="px-6 py-3">
        <span
          className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${fromBadge(
            d.discrepancy_from,
          )}`}
        >
          {d.discrepancy_from}
        </span>
      </td>
      <td className="px-6 py-3 text-slate-600">{d.reported_by ?? '—'}</td>
      <td className="px-6 py-3 text-slate-600">{d.detail_count}</td>
      <td className="px-6 py-3 text-slate-600">
        {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}
      </td>
      <td className="px-6 py-3">
        <div className="flex justify-end">
          <Link
            to={`/admin/discrepancy/${d.id}`}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            View
          </Link>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {data ? `${data.total_data} discrepancies` : 'Discrepancy'} · recorded
          automatically on Goods Receive.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search discrepancy / GR number…"
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

        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              typeFilter === 'quantity'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
            onClick={() => setTypeFilter('quantity')}
          >
            Quantity
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              typeFilter === 'quality'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
            onClick={() => setTypeFilter('quality')}
          >
            Quality
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="Discrepancy ID" col="discrepancy_id" sort={sort} onSort={onSort} />
                <th className="px-6 py-3">Source Number</th>
                <th className="px-6 py-3">Source</th>
                <SortableTh label="Type" col="type" sort={sort} onSort={onSort} />
                <SortableTh label="From" col="from" sort={sort} onSort={onSort} />
                <SortableTh label="Reported By" col="reported_by" sort={sort} onSort={onSort} />
                <th className="px-6 py-3">Items</th>
                <SortableTh label="Created" col="created_at" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-10 text-center text-slate-400"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                <>
                  {/* Outbound discrepancies grouped per Sales Order. */}
                  {withSo.map((d, i) => {
                    const newGroup =
                      i === 0 || withSo[i - 1].so_number !== d.so_number;
                    return (
                      <Fragment key={d.id}>
                        {newGroup && groupHeader(`Sales Order: ${d.so_number}`)}
                        {discRow(d)}
                      </Fragment>
                    );
                  })}
                  {/* Inbound / no Sales Order. */}
                  {withoutSo.length > 0 && (
                    <Fragment key="__no_so__">
                      {withSo.length > 0 &&
                        groupHeader('Other (inbound / no Sales Order)')}
                      {withoutSo.map((d) => discRow(d))}
                    </Fragment>
                  )}
                </>
              ) : (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-10 text-center text-slate-400"
                  >
                    No discrepancies recorded yet.
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
