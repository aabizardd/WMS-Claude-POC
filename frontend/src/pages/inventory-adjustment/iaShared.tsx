import type { ReactNode } from 'react';
import type { InventoryAdjustmentItemRow } from '../../types';

const IA_TYPE_LABELS: Record<string, string> = {
  DiscrepancyQuantity: 'Discrepancy Quantity',
  DiscrepancyQuality: 'Discrepancy Quality',
  QualityAdjustment: 'Quality Adjustment',
  Assembly: 'Assembly',
  Disassembly: 'Disassembly',
  CycleCount: 'Cycle Count',
  StockOpname: 'Stock Opname',
};

export function adjTypeLabel(t: string) {
  return IA_TYPE_LABELS[t] ?? t;
}

// PRD-06 FR-IA-12 statuses, labelled the way WMS dev shows them.
export const IA_STATUSES: [value: string, label: string][] = [
  ['WaitingApproval', 'Waiting Approval'],
  ['Approved', 'Approved'],
  ['Rejected', 'Rejected'],
  ['WaitingOracleApproval', 'Waiting Oracle'],
  ['Completed', 'Completed'],
  ['RejectedByOracle', 'Rejected by Oracle'],
];

export function adjStatusLabel(s: string | null | undefined) {
  return IA_STATUSES.find(([v]) => v === s)?.[1] ?? s ?? '-';
}

const STATUS_STYLE: Record<string, string> = {
  WaitingApproval: 'bg-[#FEF3C7] text-[#B45309] ring-[#B45309]',
  Approved: 'bg-[#E1E4F8] text-[#5166AE] ring-[#5166AE]',
  WaitingOracleApproval: 'bg-[#E0F2FE] text-[#0369A1] ring-[#0369A1]',
  Completed: 'bg-[#EFFAF4] text-[#2E8F5C] ring-[#2E8F5C]',
  Rejected: 'bg-[#FEF2F2] text-[#B91C1C] ring-[#B91C1C]',
  RejectedByOracle: 'bg-[#FEF2F2] text-[#B91C1C] ring-[#B91C1C]',
};

/** WMS dev's status pill; `compact` drops the fixed width (info grid, history). */
export function AdjStatusPill({ status, compact }: { status: string | null | undefined; compact?: boolean }) {
  const label = adjStatusLabel(status);
  return (
    <span
      title={label}
      className={`inline-flex items-center justify-center rounded-full py-1 text-center text-[12px] font-medium ring-1 ${
        compact ? 'px-3' : 'w-[130px]'
      } ${STATUS_STYLE[status ?? ''] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-300'}`}
    >
      <span className={`truncate ${compact ? '' : 'px-2'}`}>{label}</span>
    </span>
  );
}

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/** A signed adjustment: red when it takes stock away, green when it adds. */
export function SignedQty({ value, className = '' }: { value: number; className?: string }) {
  const tone = value < 0 ? 'text-red-600' : value > 0 ? 'text-green-600' : 'text-neutral-700';
  return (
    <span className={`font-bold ${tone} ${className}`}>
      {value > 0 ? '+' : ''}
      {fmtQty(value)}
    </span>
  );
}

/** Two-line cell: a strong first line and a muted second one. */
export function Stacked({ top, bottom, strong = 'font-medium' }: { top: ReactNode; bottom?: ReactNode; strong?: string }) {
  return (
    <div className="flex flex-col">
      <span className={strong}>{top || '-'}</span>
      {bottom && <span className="text-neutral-500">{bottom}</span>}
    </div>
  );
}

/**
 * An adjustment's lines as WMS dev shows them on the detail page: material, warehouse, bin, the bin's qty before, and the
 * adjustment (Qty Passed / Non-Passed for a Quality Adjustment).
 */
export function AdjLinesTable({
  lines,
  qualityMode,
  emptyText = 'This adjustment has no lines.',
}: {
  lines: InventoryAdjustmentItemRow[];
  qualityMode?: boolean;
  emptyText?: string;
}) {
  const th = 'whitespace-nowrap bg-[#F2F4FD] px-3 py-2 font-semibold text-[#5166AE]';
  const td = 'border-b border-neutral-100 px-3 py-2 align-middle';
  const cols = qualityMode ? 7 : 6;
  return (
    <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-[13px]">
      <thead>
        <tr>
          <th className={`${th} w-12`}>No</th>
          <th className={`${th} min-w-[220px]`}>Material</th>
          <th className={`${th} min-w-[200px]`}>Warehouse</th>
          <th className={`${th} min-w-[160px]`}>Bin</th>
          <th className={`${th} min-w-[160px] text-right`}>Before Adjustment</th>
          {qualityMode ? (
            <>
              <th className={`${th} min-w-[140px] text-right`}>Qty Passed</th>
              <th className={`${th} min-w-[140px] text-right`}>Qty Non-Passed</th>
            </>
          ) : (
            <th className={`${th} min-w-[160px] text-right`}>Qty Adjustment</th>
          )}
        </tr>
      </thead>
      <tbody className="text-neutral-700">
        {lines.map((l, i) => (
          <tr key={l.id} className="bg-white hover:bg-neutral-50">
            <td className={`${td} w-12`}>{i + 1}</td>
            <td className={td}>
              <Stacked top={l.material_code} bottom={l.material_name} strong="font-semibold" />
            </td>
            <td className={td}>
              <Stacked top={l.warehouse_name} bottom={l.warehouse_parent} />
            </td>
            <td className={td}>
              <Stacked top={l.bin_code ?? l.bin_label} bottom={l.bin_code ? l.bin_label : null} />
            </td>
            <td className={`${td} text-right`}>{fmtQty(l.before_qty ?? 0)}</td>
            {qualityMode ? (
              <>
                <td className={`${td} text-right`}>
                  <SignedQty value={l.qty_passed} />
                </td>
                <td className={`${td} text-right`}>{fmtQty(l.qty_non_passed)}</td>
              </>
            ) : (
              <td className={`${td} text-right`}>
                <SignedQty value={l.qty_adjustment} />
              </td>
            )}
          </tr>
        ))}
        {lines.length === 0 && (
          <tr>
            <td colSpan={cols} className="px-3 py-8 text-center text-neutral-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * An adjustment's lines in the list's accordion, styled like the other
 * tracking lists' line tables (Inventory bins, GR lines).
 */
export function AdjListLinesTable({
  lines,
  qualityMode,
  emptyText = 'This adjustment has no lines.',
}: {
  lines: InventoryAdjustmentItemRow[];
  qualityMode?: boolean;
  emptyText?: string;
}) {
  const td = 'whitespace-nowrap px-4 py-2.5';
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
          <th>No</th>
          <th>Material Code</th>
          <th>Material Name</th>
          <th>Bin Code</th>
          <th>Bin Label</th>
          <th className="text-right">Before Adjustment</th>
          {qualityMode ? (
            <>
              <th className="text-right">Qty Passed</th>
              <th className="text-right">Qty Non-Passed</th>
            </>
          ) : (
            <th className="text-right">Qty Adjustment</th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {lines.map((l, i) => (
          <tr key={l.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
            <td className={`${td} text-slate-800`}>{l.material_code ?? '-'}</td>
            <td className="px-4 py-2.5 text-slate-700">{l.material_name ?? '-'}</td>
            <td className={`${td} text-slate-800`}>{l.bin_code ?? '-'}</td>
            <td className={`${td} text-slate-700`}>{l.bin_label ?? '-'}</td>
            <td className="px-4 py-2.5 text-right text-slate-800">{fmtQty(l.before_qty ?? 0)}</td>
            {qualityMode ? (
              <>
                <td className="px-4 py-2.5 text-right">
                  <SignedQty value={l.qty_passed} className="font-medium" />
                </td>
                <td className="px-4 py-2.5 text-right text-slate-800">{fmtQty(l.qty_non_passed)}</td>
              </>
            ) : (
              <td className="px-4 py-2.5 text-right">
                <SignedQty value={l.qty_adjustment} className="font-medium" />
              </td>
            )}
          </tr>
        ))}
        {lines.length === 0 && (
          <tr>
            <td colSpan={qualityMode ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
