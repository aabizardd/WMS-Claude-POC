import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import type {
  Paginated,
  TransferOrderRow,
  TransferOrderSyncResult,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import SearchableSelect from '../../components/SearchableSelect';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;
const DEFAULT_STATUS = 'Pending Fulfillment';

interface ToStatusOption {
  status: string;
  count: number;
}

export default function TransferOrderTab() {
  const { has } = useAuth();
  const canSync = has('transfer-orders:sync');

  const [data, setData] = useState<Paginated<TransferOrderRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [statuses, setStatuses] = useState<ToStatusOption[]>([]);
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  const [syncOpen, setSyncOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncLoading, setLastSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncResult, setSyncResult] = useState<TransferOrderSyncResult | null>(null);

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<TransferOrderRow>>('/transfer-orders', {
      params: {
        page,
        limit: LIMIT,
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        ...params(),
      },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status, sort.sortBy, sort.order]);

  async function loadStatuses() {
    try {
      const r = await api.get<ToStatusOption[]>('/transfer-orders/statuses');
      setStatuses(r.data);
    } catch {
      setStatuses([]);
    }
  }
  useEffect(() => {
    loadStatuses();
  }, []);

  async function openSync() {
    setSyncError('');
    setSyncResult(null);
    setSyncOpen(true);
    setLastSyncLoading(true);
    try {
      const r = await api.get<{ lastSyncAt: string | null }>(
        '/transfer-orders/erp-last-sync',
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
      const r = await api.post<TransferOrderSyncResult>(
        '/transfer-orders/sync-erp',
        payload,
      );
      setSyncResult(r.data);
      setPage(1);
      await load();
      await loadStatuses();
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {data ? `${data.total_data} transfer orders` : 'Transfer Orders'} ·
          synced from Oracle, read-only.
        </p>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          className="input max-w-xs"
          placeholder="Search TO number / destination…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <SearchableSelect
          className="w-56"
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
          placeholder="All statuses"
          searchPlaceholder="Search status…"
          options={[
            { value: 'all', label: 'All statuses' },
            ...(statuses.some((s) => s.status === DEFAULT_STATUS)
              ? []
              : [{ value: DEFAULT_STATUS, label: DEFAULT_STATUS }]),
            ...statuses.map((s) => ({
              value: s.status,
              label: `${s.status} (${s.count})`,
            })),
          ]}
        />
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {(search || status !== DEFAULT_STATUS) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setStatus(DEFAULT_STATUS);
              setPage(1);
            }}
          >
            Reset
          </button>
        )}
      </form>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="TO Number" col="tran_id" sort={sort} onSort={onSort} />
                <SortableTh label="TO Date" col="tran_date" sort={sort} onSort={onSort} />
                <SortableTh label="From" col="from_location" sort={sort} onSort={onSort} />
                <SortableTh label="To" col="to_location" sort={sort} onSort={onSort} />
                <SortableTh label="Status" col="status_name" sort={sort} onSort={onSort} />
                <th className="px-6 py-3">Items</th>
                <SortableTh label="Last Modified" col="last_modified" sort={sort} onSort={onSort} />
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
                data.rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {t.tran_id ?? t.oracle_id}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{t.tran_date ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {t.from_location_name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {t.to_location_name ?? '—'}
                    </td>
                    <td className="px-6 py-3">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {t.status_name ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-600">{t.item_count}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {t.last_modified
                        ? new Date(t.last_modified).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/outbound/transfer-stock/list/${t.id}`}
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
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                    No transfer orders. Click “Sync from ERP” to pull data.
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

      <Modal
        open={syncOpen}
        title="Sync Transfer Orders from ERP"
        onClose={() => (syncing ? null : setSyncOpen(false))}
      >
        <form onSubmit={handleSync} className="space-y-4">
          {syncError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {syncError}
            </div>
          )}
          <p className="text-sm text-slate-500">
            Pull all transfer orders from Oracle. Incremental by last modified;
            existing orders are updated in place.
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
              </>
            ) : (
              <div className="font-medium text-slate-800">
                No previous sync — a full sync will run.
              </div>
            )}
          </div>
          {syncResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="font-medium">
                {syncResult.fullSync ? 'Full sync' : 'Incremental sync'} complete
              </div>
              <ul className="mt-1 space-y-0.5 text-emerald-700">
                <li>Total records: {syncResult.totalRecords}</li>
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
