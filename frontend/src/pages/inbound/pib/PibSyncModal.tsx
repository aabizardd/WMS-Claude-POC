import { useEffect, useState, type FormEvent } from 'react';
import api from '../../../lib/api';
import type { ErpSyncResult } from '../../../types';
import Modal from '../../../components/Modal';
import { apiError } from '../transfer/transferInbound';

interface MrnSyncResult extends ErpSyncResult {
  goodsReceiveCreated: number;
}

/**
 * Pull in-transit inbound shipments (PIB) from Oracle. Each new one becomes an
 * MRN with an Open Goods Receive. Opened from the Goods Receive list's menu.
 */
export default function PibSyncModal({
  open,
  onClose,
  onSynced,
}: {
  open: boolean;
  onClose: () => void;
  onSynced: () => void;
}) {
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncLoading, setLastSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MrnSyncResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setResult(null);
    setLastSyncLoading(true);
    api
      .get<{ lastSyncAt: string | null }>('/mrn/erp-last-sync')
      .then((r) => setLastSyncAt(r.data.lastSyncAt))
      .catch(() => setLastSyncAt(null))
      .finally(() => setLastSyncLoading(false));
  }, [open]);

  async function handleSync(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setSyncing(true);
    try {
      const r = await api.post<MrnSyncResult>('/mrn/sync-erp', lastSyncAt ? { lastModified: lastSyncAt } : {});
      setResult(r.data);
      onSynced();
    } catch (err) {
      setError(apiError(err, 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Modal open={open} title="Sync PIB from ERP" onClose={() => (syncing ? null : onClose())}>
      <form onSubmit={handleSync} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <p className="text-sm text-slate-500">
          Pull inbound shipments (status <strong>inTransit</strong>) from Oracle. Each new shipment gets a Goods
          Receive (status Open).
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          {lastSyncLoading ? (
            <span className="text-slate-400">Checking last sync time…</span>
          ) : lastSyncAt ? (
            <>
              <div className="text-slate-500">Last sync</div>
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
              <li>Shipments upserted: {result.upserted}</li>
              <li>Goods Receive created: {result.goodsReceiveCreated}</li>
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
