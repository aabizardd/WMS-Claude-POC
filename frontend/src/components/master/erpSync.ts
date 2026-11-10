import axios from 'axios';
import api from '../../lib/api';
import type { ErpSyncResult } from '../../types';

type Toast = { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void };

/**
 * The refresh button's "Sync from ERP": pulls what changed in Oracle since the
 * last sync (a full sync when there is none) and upserts it, then reports the
 * outcome as a toast. Never throws; the list is fetched again afterwards.
 */
export async function syncFromErp<R extends ErpSyncResult = ErpSyncResult>(
  base: string,
  noun: string,
  toast: Toast,
  /** More of the outcome for the toast, e.g. "3 GR created". */
  extra?: (r: R) => string | null,
) {
  toast.info(`Syncing ${noun} from ERP…`);
  try {
    const { lastSyncAt } = (await api.get<{ lastSyncAt: string | null }>(`${base}/erp-last-sync`)).data;
    const r = (await api.post<R>(`${base}/sync-erp`, lastSyncAt ? { lastModified: lastSyncAt } : {})).data;
    const more = extra?.(r);
    const summary = `${r.upserted.toLocaleString()} upserted${more ? `, ${more}` : ''}${r.failed ? `, ${r.failed.toLocaleString()} failed` : ''}`;
    if (r.failed) toast.error(`${cap(noun)} synced with errors: ${summary}.`);
    else toast.success(`${cap(noun)} synced from ERP: ${summary}.`);
  } catch (err) {
    const msg = axios.isAxiosError(err) ? err.response?.data?.message : null;
    toast.error(`${cap(noun)} sync failed: ${Array.isArray(msg) ? msg.join(', ') : (msg ?? 'please try again')}.`);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One refresh syncing several masters (e.g. Ownership: vendors and customers),
 * one after another, reported in a single toast. Never throws.
 */
export async function syncManyFromErp(targets: { base: string; noun: string }[], toast: Toast) {
  if (!targets.length) return;
  toast.info(`Syncing ${targets.map((t) => t.noun).join(' and ')} from ERP…`);
  const parts: string[] = [];
  let anyError = false;
  for (const t of targets) {
    try {
      const { lastSyncAt } = (await api.get<{ lastSyncAt: string | null }>(`${t.base}/erp-last-sync`)).data;
      const r = (await api.post<ErpSyncResult>(`${t.base}/sync-erp`, lastSyncAt ? { lastModified: lastSyncAt } : {}))
        .data;
      if (r.failed) anyError = true;
      parts.push(
        `${cap(t.noun)} ${r.upserted.toLocaleString()} upserted${r.failed ? `, ${r.failed.toLocaleString()} failed` : ''}`,
      );
    } catch (err) {
      anyError = true;
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : null;
      parts.push(`${cap(t.noun)} failed (${Array.isArray(msg) ? msg.join(', ') : (msg ?? 'please try again')})`);
    }
  }
  const text = `${parts.join('; ')}.`;
  if (anyError) toast.error(`Sync finished with errors: ${text}`);
  else toast.success(`Synced from ERP: ${text}`);
}
