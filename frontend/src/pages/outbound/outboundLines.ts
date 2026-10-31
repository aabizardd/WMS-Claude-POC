/** A picking / packing line's state as WMS dev names it. */
export function lineStatus(it: { actual_qty: number; qty_issue: number; quality_issue: number; remaining_qty: number }) {
  if (it.actual_qty + it.qty_issue + it.quality_issue <= 0) return 'Not Started';
  return it.remaining_qty > 1e-9 ? 'In Progress' : 'Completed';
}

export const fmtQty = (n: number | null | undefined) => (n ?? 0).toLocaleString();
