import type { InventoryBinGroup } from "../../types";

const fmt = (n: number) => n.toLocaleString();

/**
 * The per-bin breakdown of one inventory row. Shared by the detail page's Bin
 * List tab and the Inventory Tracking accordion, so both read the same.
 */
export default function InventoryBinTable({
  bins,
  startNo = 1,
  emptyText = "No stock in any bin.",
}: {
  bins: InventoryBinGroup[];
  /** Row number of the first bin, for a paged list. */
  startNo?: number;
  emptyText?: string;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
          <th>No</th>
          <th>Bin Code</th>
          <th>Bin Label</th>
          <th className="text-right">Stock on Hand</th>
          <th className="text-right">Available Quantity</th>
          <th className="text-right">Freeze Quantity</th>
          <th className="text-right">Quantity Issue</th>
          <th className="text-right">Quality Issue</th>
          <th className="text-right">Reserved Qty</th>
          <th className="text-right">In Transit Quantity</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {bins.map((b, i) => {
          // A KIT bin's available stock is what the header reports as Freeze Qty.
          const freeze = b.is_frozen ? b.avail_qty : 0;
          return (
            <tr key={b.bin_id ?? `no-bin-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-slate-500">{startNo + i}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-800">
                {b.bin_code ?? (b.bin_id ? "—" : "— (no bin)")}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                {b.bin_location ?? "—"}
                {b.is_frozen && (
                  <span
                    className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                    title="Frozen stock: reported as Freeze Quantity and not available to pick, adjust or transfer"
                  >
                    frozen
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-slate-800">{fmt(b.on_hand)}</td>
              <td className="px-4 py-3 text-right text-slate-800">
                {fmt(b.is_frozen ? 0 : b.avail_qty)}
              </td>
              <td className="px-4 py-3 text-right text-slate-800">{fmt(freeze)}</td>
              <td className="px-4 py-3 text-right text-slate-800">{fmt(b.qty_issue)}</td>
              <td className="px-4 py-3 text-right text-slate-800">{fmt(b.quality_issue)}</td>
              <td className="px-4 py-3 text-right text-slate-800">{fmt(b.reserved_qty)}</td>
              <td className="px-4 py-3 text-right text-slate-800">{fmt(b.in_transit_qty)}</td>
            </tr>
          );
        })}
        {bins.length === 0 && (
          <tr>
            <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
