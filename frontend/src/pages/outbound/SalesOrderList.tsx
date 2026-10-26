import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import type { Paginated, SalesOrderRow, SalesOrderSyncResult } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';
import RowActionMenu from '../../components/RowActionMenu';
import TablePager from '../../components/TablePager';
import { ExportIcon } from '../../components/ToolbarMenu';
import { ListHeader } from '../../components/ListView';
import { SO_STATUSES, soStatusBadgeClass } from '../../lib/salesOrderStatus';

/** Search waits this long after the last keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 350;

/** "2026-10-23 14:20", the way the warehouse reads it. */
function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Sales Orders open on this status by default; the user can still change it.
const DEFAULT_STATUS = 'Pending Fulfillment';

// Sales Order list + manual ERP sync. Rendered inside the "List Outbound" tab
// when the Sales Order outbound type is selected.
export default function SalesOrderList() {
  const { has } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canSync = has('sales-orders:sync');

  const [data, setData] = useState<Paginated<SalesOrderRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [reloadKey, setReloadKey] = useState(0);
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
  const [syncResult, setSyncResult] = useState<SalesOrderSyncResult | null>(null);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      setSearch((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Paginated<SalesOrderRow>>('/sales-orders', {
        params: {
          page,
          limit: pageSize,
          search: search || undefined,
          status: status || undefined,
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
  }, [page, pageSize, search, status, sort.sortBy, sort.order, reloadKey]);

  async function openSync() {
    setSyncError('');
    setSyncResult(null);
    setSyncOpen(true);
    setLastSyncLoading(true);
    try {
      const r = await api.get<{ lastSyncAt: string | null }>(
        '/sales-orders/erp-last-sync',
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
      const r = await api.post<SalesOrderSyncResult>(
        '/sales-orders/sync-erp',
        payload,
      );
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

  const rowNo = (i: number) => (page - 1) * pageSize + i + 1;
  const th = 'whitespace-nowrap';

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Sales Order"
          subtitle="Initiate a delivery request for customer orders"
          menu={[
            {
              label: 'Export',
              icon: <ExportIcon />,
              onClick: () => toast.info('Export is not available yet.'),
            },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                className="input pl-9"
                placeholder="Search by ID, Warehouse or Customer..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <select
              className="input w-auto"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
              aria-label="Status"
            >
              <option value="">All Status</option>
              {SO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Opens in its own tab: a blank board you search from, with the
                order's items under each row. */}
            <a
              href="/admin/outbound/sales-order/tracking"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              SO Tracking
            </a>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
              // Refresh pulls the latest orders from Oracle; without the sync
              // permission it just reloads what WMS already has.
              onClick={() => (canSync ? openSync() : setReloadKey((k) => k + 1))}
              aria-label={canSync ? 'Sync from ERP' : 'Refresh'}
              title={canSync ? 'Sync from ERP' : 'Refresh'}
            >
              <svg
                className={`h-4 w-4 ${loading || syncing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr className="[&>th]:font-medium [&_button]:normal-case [&_button]:tracking-normal">
                <th className="px-4 py-3 font-medium">No</th>
                <SortableTh label="Status" col="status_name" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Transaction ID" col="tran_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="ERP Doc ID" col="oracle_id" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Doc Type</th>
                <SortableTh label="Ownership" col="ownership" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Warehouse Name" col="location" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Customer Name" col="customer_name" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Created By" col="created_by" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <SortableTh label="Created At" col="created_at" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="whitespace-nowrap px-4 py-3 font-medium">Last Modified By</th>
                <SortableTh label="Last Modified At" col="last_modified" sort={sort} onSort={onSort} pad="px-4" className={th} />
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={13} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((s, i) => (
                  <tr key={s.id} className={`group hover:bg-slate-50 ${loading ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 text-slate-500">{rowNo(i)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-medium ${
                          soStatusBadgeClass(s.status_name)
                        }`}
                      >
                        {s.status_name ?? '-'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-800">{s.tran_id ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.oracle_id}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">Sales Order</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.ownership ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{s.warehouse?.name ?? s.location_name ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{s.customer_name ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.created_by ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(s.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.last_modified_by ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(s.last_modified)}</td>
                    <td className="sticky right-0 bg-white px-4 py-3 text-center shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)] group-hover:bg-slate-50">
                      <RowActionMenu
                        actions={[
                          {
                            label: 'Detail',
                            icon: (
                              <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            ),
                            onClick: () => navigate(`/admin/outbound/sales-order/list/${s.id}`),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="px-6 py-10 text-center text-slate-400">
                    {search || status
                      ? 'No sales order matches the search.'
                      : 'No sales orders. Click the refresh button to pull data from ERP.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="px-1 pb-1 pt-2">
        <TablePager
          page={page}
          pageSize={pageSize}
          total={data?.total_data ?? 0}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      <Modal
        open={syncOpen}
        title="Sync Sales Orders from ERP"
        onClose={() => (syncing ? null : setSyncOpen(false))}
      >
        <form onSubmit={handleSync} className="space-y-4">
          {syncError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {syncError}
            </div>
          )}
          <p className="text-sm text-slate-500">
            Pull all sales orders from Oracle. Incremental by last modified;
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
                <li>Unchanged: {syncResult.unchanged}</li>
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

