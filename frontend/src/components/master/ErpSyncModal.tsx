import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../Modal';
import type { ErpSyncResult } from '../../types';

/**
 * "Sync … from ERP": pulls the records changed since the last sync from Oracle
 * and upserts them. `base` is the master's endpoint (e.g. "/warehouses").
 */
export default function ErpSyncModal({
  open,
  onClose,
  base,
  noun,
  onSynced,
}: {
  open: boolean;
  onClose: () => void;
  base: string;
  noun: string;
  onSynced: () => void;
}) {
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncLoading, setLastSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ErpSyncResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setResult(null);
    setLastSyncLoading(true);
    api
      .get<{ lastSyncAt: string | null }>(`${base}/erp-last-sync`)
      .then((r) => setLastSyncAt(r.data.lastSyncAt))
      .catch(() => setLastSyncAt(null))
      .finally(() => setLastSyncLoading(false));
  }, [open, base]);

  async function handleSync(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setSyncing(true);
    try {
      const payload = lastSyncAt ? { lastModified: lastSyncAt } : {};
      const r = await api.post<ErpSyncResult>(`${base}/sync-erp`, payload);
      setResult(r.data);
      onSynced();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Sync failed');
      } else setError('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Modal open={open} title={`Sync ${noun} from ERP`} onClose={() => (syncing ? null : onClose())}>
      <form onSubmit={handleSync} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <p className="text-sm text-slate-500">
          Pull {noun} from Oracle and upsert them. The sync window is determined automatically from
          the last sync time.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          {lastSyncLoading ? (
            <span className="text-slate-400">Checking last sync time…</span>
          ) : lastSyncAt ? (
            <>
              <div className="text-slate-500">Last sync (created_at)</div>
              <div className="font-medium text-slate-800">{new Date(lastSyncAt).toLocaleString()}</div>
            </>
          ) : (
            <div className="font-medium text-slate-800">No previous sync — a full sync will run.</div>
          )}
        </div>
        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-medium">{result.fullSync ? 'Full sync' : 'Incremental sync'} complete</div>
            <ul className="mt-1 space-y-0.5 text-emerald-700">
              <li>Total records: {result.totalRecords}</li>
              <li>Upserted: {result.upserted}</li>
              <li>Failed: {result.failed}</li>
              <li>Duration: {(result.durationMs / 1000).toFixed(1)}s</li>
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={syncing}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="btn-primary" disabled={syncing || lastSyncLoading}>
            {syncing ? 'Syncing…' : 'Start sync'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
