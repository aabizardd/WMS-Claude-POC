import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import type { ErpSyncResult, Material, Paginated } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

export default function MaterialsPage() {
  const [data, setData] = useState<Paginated<Material> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  // RBAC
  const { has } = useAuth();
  const canSync = has('materials:sync');
  const canUpdate = has('materials:update');
  const [syncOpen, setSyncOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncLoading, setLastSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncResult, setSyncResult] = useState<ErpSyncResult | null>(null);

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<Material>>('/materials', {
      params: { page, limit: LIMIT, search: search || undefined, ...params() },
    });
    setData(r.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, sort.sortBy, sort.order]);

  async function openSync() {
    setSyncError('');
    setSyncResult(null);
    setSyncOpen(true);
    setLastSyncLoading(true);
    try {
      const r = await api.get<{ lastSyncAt: string | null }>(
        '/materials/erp-last-sync',
      );
      setLastSyncAt(r.data.lastSyncAt);
    } catch {
      setLastSyncAt(null);
    } finally {
      setLastSyncLoading(false);
    }
  }

  async function handleSync(e: FormEvent) {
    e.preventDefault();
    setSyncError('');
    setSyncResult(null);
    setSyncing(true);
    try {
      const payload = lastSyncAt ? { lastModified: lastSyncAt } : {};
      const r = await api.post<ErpSyncResult>('/materials/sync-erp', payload);
      setSyncResult(r.data);
      setPage(1);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setSyncError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Sync failed');
      } else setSyncError('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Material Info</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `${data.total_data} materials` : 'Materials'} · for ERP items,
            code &amp; name come from Oracle; other fields are editable.
          </p>
        </div>
        {canSync && (
          <button className="btn-secondary" onClick={openSync}>
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8"
              />
            </svg>
            Sync from ERP
          </button>
        )}
      </div>

      {/* Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        className="flex gap-2"
      >
        <input
          className="input max-w-xs"
          placeholder="Search code or name…"
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
                <SortableTh label="ERP ID" col="erp_id" sort={sort} onSort={onSort} />
                <SortableTh label="Code" col="material_code" sort={sort} onSort={onSort} />
                <SortableTh label="Name" col="material_name" sort={sort} onSort={onSort} />
                <SortableTh label="Category" col="material_category" sort={sort} onSort={onSort} />
                <SortableTh label="Type" col="material_type" sort={sort} onSort={onSort} />
                <SortableTh label="Primary UOM" col="primary_uom" sort={sort} onSort={onSort} />
                <th className="px-6 py-3">Qty</th>
                <th className="px-6 py-3">Source</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((m) => {
                  const fromErp = !!m.erp_doc_id;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 text-slate-500">
                        {m.erp_doc_id ?? '—'}
                      </td>
                      <td className="px-6 py-3 font-medium text-slate-800">
                        {m.material_code}
                      </td>
                      <td className="max-w-xs truncate px-6 py-3 text-slate-600">
                        {m.material_name || (
                          <span className="text-slate-300">(no name)</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {m.material_category?.material_category_name ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {m.material_type?.material_type_name ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {m.primary_uom?.uom_code ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-slate-600">{m.material_qty}</td>
                      <td className="px-6 py-3">
                        {fromErp ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                              />
                            </svg>
                            ERP
                          </span>
                        ) : (
                          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                            WMS
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex justify-end">
                          <Link
                            to={`/admin/materials/${m.id}/edit`}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                          >
                            {canUpdate ? 'Edit' : 'View'}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-slate-400">
                    No materials found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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

      {/* ERP Sync modal */}
      <Modal
        open={syncOpen}
        title="Sync materials from ERP"
        onClose={() => (syncing ? null : setSyncOpen(false))}
      >
        <form onSubmit={handleSync} className="space-y-4">
          {syncError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {syncError}
            </div>
          )}

          <p className="text-sm text-slate-500">
            Pull items from Oracle and upsert them into materials (matched by ERP
            ID). The sync window is determined automatically from the last sync
            time — no input needed.
          </p>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            {lastSyncLoading ? (
              <span className="text-slate-400">Checking last sync time…</span>
            ) : lastSyncAt ? (
              <>
                <div className="text-slate-500">Last sync (created_at)</div>
                <div className="font-medium text-slate-800">
                  {new Date(lastSyncAt).toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Will sync items modified since this time.
                </div>
              </>
            ) : (
              <>
                <div className="font-medium text-slate-800">
                  No previous sync found
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  A full sync of all items will run.
                </div>
              </>
            )}
          </div>

          {syncResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="font-medium">
                {syncResult.fullSync ? 'Full sync' : 'Incremental sync'} complete
              </div>
              <ul className="mt-1 space-y-0.5 text-emerald-700">
                <li>Total records: {syncResult.totalRecords}</li>
                <li>
                  Pages fetched: {syncResult.pagesFetched} / {syncResult.totalPages}
                </li>
                <li>Upserted: {syncResult.upserted}</li>
                <li>Failed: {syncResult.failed}</li>
                <li>Duration: {(syncResult.durationMs / 1000).toFixed(1)}s</li>
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSyncOpen(false)}
              disabled={syncing}
            >
              {syncResult ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={syncing || lastSyncLoading}
            >
              {syncing ? 'Syncing…' : 'Start sync'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
