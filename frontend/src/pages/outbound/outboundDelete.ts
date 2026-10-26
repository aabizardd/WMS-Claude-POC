import axios from 'axios';
import api from '../../lib/api';
import type { ConfirmOptions } from '../../context/ConfirmContext';

/**
 * Deleting an Open Delivery Plan or Packing sends the documents it was made
 * from back to Open — they are packed / picked again — and returns any issue
 * stock their closing had set aside to Reserved. The copy says so before the
 * user confirms.
 */
const COPY = {
  delivery: {
    path: '/delivery',
    noun: 'delivery plan',
    description:
      'Every packing on this delivery plan goes back to Open with its progress cleared, so it has to be packed again. Qty / quality issue stock from packing returns to Reserved and its discrepancies are removed.',
    done: 'Delivery plan deleted — packing reopened',
  },
  packing: {
    path: '/packing',
    noun: 'packing',
    description:
      'Every picking in this packing goes back to Open with its progress cleared, so it has to be picked again. Qty / quality issue stock from picking returns to Reserved and its discrepancies are removed.',
    done: 'Packing deleted — picking reopened',
  },
} as const;

export async function deleteOutboundDoc(
  kind: keyof typeof COPY,
  id: string,
  code: string,
  confirm: (o: ConfirmOptions) => Promise<boolean>,
  toast: { success: (m: string) => void; error: (m: string) => void },
): Promise<boolean> {
  const c = COPY[kind];
  const ok = await confirm({
    title: `Delete ${c.noun} ${code}?`,
    description: c.description,
    type: 'danger',
    confirmText: 'Delete',
  });
  if (!ok) return false;
  try {
    await api.delete(`${c.path}/${id}`);
    toast.success(c.done);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err) ? err.response?.data?.message : null;
    toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Delete failed');
    return false;
  }
}
