import type { DeliveryItemRow } from '../../types';

/**
 * A delivery's materials in the Delivery Plan accordion: the same columns as
 * the detail page's Material List, styled like the other list accordions.
 * Staging Bin is where the packed line waits; Picking Bin is where it was
 * picked from.
 */
export default function DeliveryItemsTable({
  items,
  packingId,
  emptyText = 'This delivery has no materials.',
}: {
  items: DeliveryItemRow[];
  packingId: string | null;
  emptyText?: string;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
          <th>No</th>
          <th>Packing ID</th>
          <th>Material Code</th>
          <th>Material Name</th>
          <th className="text-right">ERP Line</th>
          <th className="text-right">Quantity</th>
          <th>UOM</th>
          <th>Staging Bin</th>
          <th>Picking Bin</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {items.map((it, i) => (
          <tr key={it.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{packingId ?? '-'}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{it.material_code ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{it.material_name ?? '-'}</td>
            <td className="px-4 py-2.5 text-right text-slate-700">{it.line_number ?? '-'}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{it.qty.toLocaleString()}</td>
            <td className="px-4 py-2.5 text-slate-700">{it.uom ?? '-'}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{it.bin_label ?? '-'}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{it.picked_bins?.join(', ') || '-'}</td>
          </tr>
        ))}
        {items.length === 0 && (
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
