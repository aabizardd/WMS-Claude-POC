/** Oracle's sales-order statuses, in the order the status filter lists them. */
export const SO_STATUSES = [
  'Open',
  'Pending Approval',
  'Pending Fulfillment',
  'Pending Billing',
  'Pending Billing/Partially Fulfilled',
  'Partially Fulfilled',
  'Billed',
  'Closed',
  'Cancelled',
  'Rejected',
];

/** Oracle's transfer-order statuses, in the order the status filter lists them. */
export const TO_STATUSES = [
  'Open',
  'Pending Approval',
  'Pending Fulfillment',
  'Partially Fulfilled',
  'Pending Receipt/Partially Fulfilled',
  'Pending Receipt',
  'Received',
  'Closed',
  'Cancelled',
  'Rejected',
];

const STATUS_BADGE: Record<string, string> = {
  Open: 'border-sky-300 bg-sky-50 text-sky-700',
  'Pending Approval': 'border-violet-300 bg-violet-50 text-violet-700',
  'Pending Fulfillment': 'border-orange-300 bg-orange-50 text-orange-700',
  'Pending Billing': 'border-amber-300 bg-amber-50 text-amber-700',
  'Pending Billing/Partially Fulfilled': 'border-amber-300 bg-amber-50 text-amber-700',
  'Partially Fulfilled': 'border-blue-300 bg-blue-50 text-blue-700',
  Billed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  'Pending Receipt': 'border-amber-300 bg-amber-50 text-amber-700',
  'Pending Receipt/Partially Fulfilled': 'border-amber-300 bg-amber-50 text-amber-700',
  Received: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  Closed: 'border-slate-300 bg-slate-100 text-slate-600',
  Cancelled: 'border-rose-300 bg-rose-50 text-rose-700',
  Rejected: 'border-rose-300 bg-rose-50 text-rose-700',
  // Purchase orders (Local Vendor), plus WMS's own "On Progress".
  'Pending Supervisor Approval': 'border-violet-300 bg-violet-50 text-violet-700',
  'Pending Billing/Partially Received': 'border-amber-300 bg-amber-50 text-amber-700',
  'Partially Received': 'border-blue-300 bg-blue-50 text-blue-700',
  'Pending Bill': 'border-amber-300 bg-amber-50 text-amber-700',
  'Fully Billed': 'border-emerald-300 bg-emerald-50 text-emerald-700',
  'Rejected by Supervisor': 'border-rose-300 bg-rose-50 text-rose-700',
  'On Progress': 'border-orange-300 bg-orange-50 text-orange-700',
};

/** Outlined pill colours for an Oracle sales-, transfer- or purchase-order status. */
export function soStatusBadgeClass(status: string | null | undefined): string {
  return STATUS_BADGE[status ?? ''] ?? 'border-slate-300 bg-slate-50 text-slate-600';
}
