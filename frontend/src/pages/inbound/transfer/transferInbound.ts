import axios from 'axios';
import api from '../../../lib/api';
import type { ConfirmOptions } from '../../../context/ConfirmContext';

/** The Material List search text of a Transfer IN line. */
export const materialText = (r: { material_code: string | null; material_name: string | null }) =>
  `${r.material_code ?? ''} ${r.material_name ?? ''}`;

/** The API's message of a failed request. */
export function apiError(err: unknown, fallback: string) {
  if (axios.isAxiosError(err)) {
    const m = err.response?.data?.message;
    return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
  }
  return fallback;
}

const COPY = {
  gr: {
    path: '/transfer-inbound/goods-receive',
    noun: 'Goods Receive',
    description: 'The GR List is removed and its planned quantity is free again on the Transfer Order lines.',
  },
  putaway: {
    path: '/transfer-inbound/putaway',
    noun: 'Putaway',
    description:
      'The putaway is removed: its stock leaves the destination bin and the quantity goes back to the Goods Receive to be put away again.',
  },
} as const;

/** Confirm, then delete an Open Transfer IN GR List or an untouched putaway. */
export async function deleteTransferDoc(
  kind: keyof typeof COPY,
  id: string,
  code: string,
  confirm: (o: ConfirmOptions) => Promise<boolean>,
  toast: { success: (m: string) => void; error: (m: string) => void },
) {
  const c = COPY[kind];
  const ok = await confirm({ title: `Delete ${c.noun} ${code}?`, description: c.description, type: 'danger', confirmText: 'Delete' });
  if (!ok) return false;
  try {
    await api.delete(`${c.path}/${id}`);
    toast.success(`${c.noun} ${code} deleted`);
    return true;
  } catch (err) {
    toast.error(apiError(err, 'Delete failed'));
    return false;
  }
}

/** Download rows as a CSV file (the ☰ Export of a detail page). */
export function exportCsv(filename: string, columns: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
