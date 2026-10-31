import type { SalesOrderItemRow } from '../../types';

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/**
 * A Sales Order's lines in the list accordion. Same columns as the detail
 * page's Material List (as on WMS dev).
 */
export default function SalesOrderLinesTable({
  lines,
  emptyText = 'This order has no items.',
}: {
  lines: SalesOrderItemRow[];
  emptyText?: string;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
          <th>No</th>
          <th>Material Code</th>
          <th>Material Name</th>
          <th>UOM</th>
          <th className="text-right">Available Qty</th>
          <th className="text-right">Request Qty</th>
          <th className="text-right">Given Qty</th>
          <th className="text-right">Remaining Qty</th>
          <th className="text-right">Actual Delivery</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {lines.map((it, i) => (
          <tr key={it.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">
              {it.material_code ?? <span className="text-slate-300">unmatched</span>}
            </td>
            <td className="px-4 py-2.5 text-slate-700">{it.material_name ?? it.item_name ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{it.uom ?? '-'}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.available_qty)}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.quantity)}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.given_qty)}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.remaining_qty)}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.actual_delivery)}</td>
          </tr>
        ))}
        {lines.length === 0 && (
          <tr>
            <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
