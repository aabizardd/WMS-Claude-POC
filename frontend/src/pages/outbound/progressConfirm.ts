import type { ConfirmOptions } from '../../context/ConfirmContext';

const EPS = 1e-9;

export interface ProgressRow {
  /** What the line still had to process before this save. */
  remaining: number;
  actual: number;
  qtyIssue: number;
  quality: number;
}

/**
 * The confirm dialog before saving Picking / Packing progress. Actual starts
 * filled with the remaining qty, so pressing Save without touching anything
 * closes the document with every unit counted as done and no issues — that
 * case gets its own warning, and any save that closes the document says so.
 */
export function progressConfirm(doc: 'picking' | 'packing', rows: ProgressRow[]): ConfirmOptions {
  const verb = doc === 'picking' ? 'picked' : 'packed';
  const willClose = rows.every((r) => r.remaining - (r.actual + r.qtyIssue + r.quality) <= EPS);
  const untouched = rows.every(
    (r) => Math.abs(r.actual - r.remaining) <= EPS && r.qtyIssue <= EPS && r.quality <= EPS,
  );
  const sum = (k: 'actual' | 'qtyIssue' | 'quality') => rows.reduce((s, r) => s + r[k], 0);

  if (willClose && untouched) {
    return {
      title: `Close this ${doc} with everything ${verb}?`,
      description:
        `You have not changed any quantity. All ${sum('actual')} qty will be recorded as ${verb} ` +
        `with no qty issue or quality issue, and the ${doc} will be Closed — it can no longer be ` +
        `edited. If something was short or damaged, cancel and enter it in Qty Issue / Quality Issue first.`,
      type: 'warning',
      confirmText: `Yes, close ${doc}`,
      cancelText: 'Review quantities',
    };
  }
  if (willClose) {
    return {
      title: `Save and close this ${doc}?`,
      description:
        `Nothing will remain after this save, so the ${doc} will be Closed and can no longer be edited: ` +
        `${sum('actual')} ${verb}, ${sum('qtyIssue')} qty issue, ${sum('quality')} quality issue. ` +
        `Inventory and discrepancies are settled on close.`,
      type: 'warning',
      confirmText: `Save & close ${doc}`,
    };
  }
  return {
    title: `Save ${doc} progress?`,
    description: `The ${doc} status will update automatically. When remaining reaches 0 it will be Closed and inventory/discrepancy settled.`,
    type: 'info',
    confirmText: 'Save',
  };
}
