import api from '../../../lib/api';
import type { ConfirmOptions } from '../../../context/ConfirmContext';
import { apiError } from '../transfer/transferInbound';

/** Confirm, then delete an untouched PIB putaway: its qty goes back to the GR. */
export async function deletePibPutaway(
  id: string,
  code: string,
  confirm: (o: ConfirmOptions) => Promise<boolean>,
  toast: { success: (m: string) => void; error: (m: string) => void },
) {
  const ok = await confirm({
    title: `Delete Putaway ${code}?`,
    description: 'The putaway is removed and its quantity goes back to the Goods Receive to be put away again.',
    type: 'danger',
    confirmText: 'Delete',
  });
  if (!ok) return false;
  try {
    await api.delete(`/pib-inbound/putaway/${id}`);
    toast.success(`Putaway ${code} deleted`);
    return true;
  } catch (err) {
    toast.error(apiError(err, 'Delete failed'));
    return false;
  }
}
