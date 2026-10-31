import { Navigate, useLocation } from 'react-router-dom';
import type { SalesOrderFilter } from '../../types';

/**
 * SO Tracking now lives on the Sales Order list. An old tracking link lands
 * there with the same search: its Status filter becomes the list's status,
 * the other filters carry over as they are.
 */
export default function SoTrackingRedirect() {
  const { search } = useLocation();
  const from = new URLSearchParams(search);
  const next = new URLSearchParams();
  try {
    const filters = JSON.parse(from.get('filters') ?? '[]') as SalesOrderFilter[];
    const status = filters.find((f) => f.field === 'status_name')?.values[0];
    const rest = filters.filter((f) => f.field !== 'status_name');
    next.set('status', status ?? '');
    if (rest.length) next.set('filters', JSON.stringify(rest));
  } catch {
    // A hand-edited link: open the list as it is.
  }
  const qs = next.toString();
  return <Navigate to={`/admin/outbound/sales-order/list${qs ? `?${qs}` : ''}`} replace />;
}
