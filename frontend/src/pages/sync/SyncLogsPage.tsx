import { useEffect, useState } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import type { Paginated, SyncLogRow } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

const LIMIT = 10;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-700',
    partial: 'bg-amber-50 text-amber-700',
    failed: 'bg-rose-50 text-rose-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}

export default function SyncLogsPage() {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canRetry = has('sync-logs:update');

  const [data, setData] = useState<Paginated<SyncLogRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('failed'); // default: show failures
  const [retrying, setRetrying] = useState<string | null>(null);
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<SyncLogRow>>('/sync-logs', {
      params: { page, limit: LIMIT, status: status || undefined, ...params() },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, sort.sortBy, sort.order]);

  async function handleRetry(row: SyncLogRow) {
    const ok = await confirm({
      title: `Retry ${row.module} sync?`,
      description: `Re-runs the ${row.module} sync using the same "since" value.`,
      type: 'info',
      confirmText: 'Retry',
    });
    if (!ok) return;
    setRetrying(row.id);
    try {
      const r = await api.post<SyncLogRow>(`/sync-logs/${row.id}/retry`);
      if (r.data.status === 'failed') {
        toast.error(`Retry failed: ${r.data.message ?? row.module}`);
      } else if (r.data.status === 'partial') {
        toast.warning(`Retry partial: ${r.data.failed ?? 0} still failing`);
      } else {
        toast.success(`${row.module} synced successfully`);
      }
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Retry failed');
      } else toast.error('Retry failed');
    } finally {
      setRetrying(null);
    }
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Sync Logs</h1>
        <p className="page-subtitle">
          Background Oracle syncs that failed or partially failed — review and retry.
        </p>
      </div>

      <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
        {[
          { v: 'failed', l: 'Failed' },
          { v: 'partial', l: 'Partial' },
          { v: '', l: 'All' },
        ].map((t) => (
          <button
            key={t.v || 'all'}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              status === t.v
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-800 dark:text-slate-300'
            }`}
            onClick={() => {
              setPage(1);
              setStatus(t.v);
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="table-head">
              <tr>
                <SortableTh label="Module" col="module" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="Trigger" col="trigger" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="Upserted" col="upserted" sort={sort} onSort={onSort} align="right" pad="px-5" />
                <SortableTh label="Failed" col="failed" sort={sort} onSort={onSort} align="right" pad="px-5" />
                <SortableTh label="Message" col="message" sort={sort} onSort={onSort} pad="px-5" />
                <SortableTh label="When" col="created_at" sort={sort} onSort={onSort} pad="px-5" />
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">{r.module}</td>
                    <td className="px-5 py-3 text-slate-600">{r.trigger}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${statusBadge(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{r.upserted ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{r.failed ?? '—'}</td>
                    <td className="px-5 py-3 max-w-xs truncate text-slate-600" title={r.message ?? ''}>
                      {r.message ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        {canRetry && r.status !== 'success' ? (
                          <button
                            onClick={() => handleRetry(r)}
                            disabled={retrying === r.id}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-500/10"
                          >
                            {retrying === r.id ? 'Retrying…' : 'Retry'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                    No sync issues logged. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPage > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
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
