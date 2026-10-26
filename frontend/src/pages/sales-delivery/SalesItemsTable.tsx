import type { SalesDeliveryItem } from '../../types';

const fmt = (n: number) => n.toLocaleString();

/**
 * The items of one Sales Delivery / Return in the list's accordion. Styled
 * like the Inventory bin list and the Transfer Order lines.
 */
export default function SalesItemsTable({
  items,
  isReturn = false,
  emptyText = 'This document has no items.',
}: {
  items: SalesDeliveryItem[];
  /** A Sales Return's quantity is what came back, not what went out. */
  isReturn?: boolean;
  emptyText?: string;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
          <th>No</th>
          <th>Material Code</th>
          <th>Material Name</th>
          <th>Bin</th>
          <th>UOM</th>
          <th className="text-right">{isReturn ? 'Qty Returned' : 'Qty Transfer'}</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {items.map((it, i) => (
          <tr key={it.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{it.material_code ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{it.material_name ?? '-'}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{it.bin_label ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{it.uom_code ?? '-'}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(it.qty_transfer)}</td>
            <td className="px-4 py-2.5 text-slate-700">
              <span className="block max-w-[14rem] truncate" title={it.remarks ?? ''}>
                {it.remarks}
              </span>
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
