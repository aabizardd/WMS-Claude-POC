import type { TransferOrderLine } from '../../types';

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/**
 * A Transfer Order's lines seen from the destination (TO In), with WMS dev's
 * Material List columns. Shared by the list's accordion and the detail page;
 * the detail passes `selection` to add the checkbox column.
 */
export default function TransferInLinesTable({
  lines,
  startNo = 1,
  emptyText = 'This order has no lines.',
  selection,
}: {
  lines: TransferOrderLine[];
  /** Row number of the first line, for a paged list. */
  startNo?: number;
  emptyText?: string;
  selection?: {
    checked: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: () => void;
    allChecked: boolean;
    someChecked: boolean;
    /** Only lines with something left to put on a GR can be ticked. */
    canTick: (l: TransferOrderLine) => boolean;
  };
}) {
  const cols = selection ? 13 : 12;
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
          {selection && (
            <th className="w-10">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                checked={selection.allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = selection.someChecked && !selection.allChecked;
                }}
                onChange={selection.onToggleAll}
                aria-label="Select every line with qty to receive"
              />
            </th>
          )}
          <th>No</th>
          <th>ERP Line Number</th>
          <th>Material Code</th>
          <th>Material Name</th>
          <th>Material Type</th>
          <th>Material Category</th>
          <th>UoM</th>
          <th className="text-right">Request Quantity</th>
          <th className="text-right">Shipped Quantity</th>
          <th className="text-right">GR Quantity</th>
          <th className="text-right">Receive Quantity</th>
          <th className="text-right">Remain Quantity</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {lines.map((l, i) => {
          const ticked = selection?.checked.has(l.id) ?? false;
          return (
            <tr key={l.id} className={ticked ? 'bg-brand-50/50' : 'hover:bg-slate-50'}>
              {selection && (
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                    checked={ticked}
                    disabled={!selection.canTick(l)}
                    onChange={() => selection.onToggle(l.id)}
                    title={selection.canTick(l) ? undefined : 'Nothing left to receive'}
                    aria-label={`Select ${l.material_code ?? l.item_name ?? 'line'}`}
                  />
                </td>
              )}
              <td className="px-4 py-2.5 text-slate-500">{startNo + i}</td>
              <td className="px-4 py-2.5 text-slate-700">{l.line_number}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{l.material_code ?? l.item_name ?? '-'}</td>
              <td className="px-4 py-2.5 text-slate-700">{l.material_name ?? '-'}</td>
              <td className="px-4 py-2.5 text-slate-700">{l.material_type ?? '-'}</td>
              <td className="px-4 py-2.5 text-slate-700">{l.material_category ?? '-'}</td>
              <td className="px-4 py-2.5 text-slate-700">{l.uom ?? '-'}</td>
              <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.quantity)}</td>
              <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.shipped_qty)}</td>
              <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.gr_qty)}</td>
              <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.receive_qty)}</td>
              <td className="px-4 py-2.5 text-right font-medium text-slate-800">{fmt(l.remain_qty)}</td>
            </tr>
          );
        })}
        {lines.length === 0 && (
          <tr>
            <td colSpan={cols} className="px-4 py-8 text-center text-slate-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
