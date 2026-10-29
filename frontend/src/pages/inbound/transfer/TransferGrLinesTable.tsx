import type { TransferGrListLine } from '../../../types';

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/** A Goods Receive's lines in the list's accordion: material info and every qty bucket. */
export default function TransferGrLinesTable({
  lines,
  emptyText = 'This Goods Receive has no lines.',
}: {
  lines: TransferGrListLine[];
  emptyText?: string;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
          <th>No</th>
          <th>ERP Line ID</th>
          <th>Material Code</th>
          <th>Material Name</th>
          <th>Material Type</th>
          <th>Material Category</th>
          <th>UoM</th>
          <th className="text-right">Planned Qty</th>
          <th className="text-right">Actual Qty</th>
          <th className="text-right">Putaway Qty</th>
          <th className="text-right">Remain Qty</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {lines.map((l, i) => (
          <tr key={l.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
            <td className="px-4 py-2.5 text-slate-700">{l.line_number ?? '-'}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{l.material_code ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{l.material_name ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{l.material_type ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{l.material_category ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{l.uom ?? '-'}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.planned_qty)}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.actual_qty)}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmt(l.putaway_qty)}</td>
            <td className="px-4 py-2.5 text-right font-medium text-slate-800">{fmt(l.remain_qty)}</td>
          </tr>
        ))}
        {lines.length === 0 && (
          <tr>
            <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
