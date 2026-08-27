import type { InventoryAdjustmentType } from '@prisma/client';

/**
 * PRD-06 "Matriks Perilaku per Tipe IA" in one place. Every type-dependent
 * decision in the service reads from here, so the behaviour matrix can be
 * checked against the document without chasing conditionals.
 */

// How the qty fields of a line are filled.
export type QtyMode =
  // Auto-filled with -(bucket) and read-only (Discrepancy Quantity / Quality).
  | 'auto_negative'
  // Two positive inputs: qtyPassed + qtyNonPassed (Quality Adjustment).
  | 'passed_non_passed'
  // Free signed input (Assembly / Disassembly / Cycle Count / Stock Opname).
  | 'free_signed';

// Which stock bucket the selectable inventory/bin list is filtered on.
export type SourceBucket = 'qty_issue' | 'quality_issue' | 'none';

export interface IaRule {
  /** Name sent to Oracle in the memo. Agreed with the Oracle team; never translated. */
  oracleLabel: string;
  qtyMode: QtyMode;
  /** FR-IA-05: only bins with this bucket > 0 can be picked. */
  filterBucket: SourceBucket;
  /** FR-IA-10: the discrepancy reference list is shown only for these types. */
  discrepancyList: false | 'quantity' | 'quality';
  /** FR-IA-13: 'always' | 'never' | 'conditional' (Quality Adjustment). */
  oracleHit: 'always' | 'conditional';
}

export const IA_RULES: Record<InventoryAdjustmentType, IaRule> = {
  DiscrepancyQuantity: {
    oracleLabel: 'Discrepancy Quantity',
    qtyMode: 'auto_negative',
    filterBucket: 'qty_issue',
    discrepancyList: 'quantity',
    oracleHit: 'always',
  },
  DiscrepancyQuality: {
    oracleLabel: 'Discrepancy Quality',
    qtyMode: 'auto_negative',
    filterBucket: 'quality_issue',
    discrepancyList: 'quality',
    oracleHit: 'always',
  },
  QualityAdjustment: {
    oracleLabel: 'Quality Adjustment',
    qtyMode: 'passed_non_passed',
    filterBucket: 'quality_issue',
    discrepancyList: false,
    oracleHit: 'conditional',
  },
  Assembly: {
    oracleLabel: 'Assembly',
    qtyMode: 'free_signed',
    filterBucket: 'none',
    discrepancyList: false,
    oracleHit: 'always',
  },
  Disassembly: {
    oracleLabel: 'Disassembly',
    qtyMode: 'free_signed',
    filterBucket: 'none',
    discrepancyList: false,
    oracleHit: 'always',
  },
  CycleCount: {
    oracleLabel: 'Cycle Count',
    qtyMode: 'free_signed',
    filterBucket: 'none',
    discrepancyList: false,
    oracleHit: 'always',
  },
  StockOpname: {
    oracleLabel: 'Stock Opname',
    qtyMode: 'free_signed',
    filterBucket: 'none',
    discrepancyList: false,
    oracleHit: 'always',
  },
};

export const IA_TYPES = Object.keys(IA_RULES) as InventoryAdjustmentType[];

export function ruleFor(type: InventoryAdjustmentType): IaRule {
  return IA_RULES[type];
}

/**
 * FR-IA-03: the value Oracle receives in `memo`.
 *   "{IA Type} | {memo}", or just "{IA Type}" when the memo is empty.
 * If the result exceeds the Oracle field limit the memo is truncated and the
 * IA Type prefix is always preserved.
 */
export const ORACLE_MEMO_MAX = Number(process.env.ORACLE_ADJ_MEMO_MAX ?? 999);

export function buildOracleMemo(
  type: InventoryAdjustmentType,
  memo: string | null | undefined,
): string {
  const label = IA_RULES[type].oracleLabel;
  const text = (memo ?? '').trim();
  if (!text) return label.slice(0, ORACLE_MEMO_MAX);

  const full = `${label} | ${text}`;
  if (full.length <= ORACLE_MEMO_MAX) return full;

  const room = ORACLE_MEMO_MAX - (label.length + 3);
  // No room for any memo text — keep the type name alone.
  if (room <= 0) return label.slice(0, ORACLE_MEMO_MAX);
  return `${label} | ${text.slice(0, room)}`;
}

/**
 * FR-IA-14 + the product owner's ruling on PRD open question #1.
 *
 * NOTE — deliberate deviation from the PRD text: the FR-IA-14 matrix says
 * Discrepancy Quality sets Quality Issue to 0 in WMS. The product owner
 * confirmed the original rule instead: Discrepancy Quality reduces Oracle only
 * and leaves the WMS Quality Issue bucket untouched. Quality Adjustment is what
 * draws that bucket down.
 *
 * Open question #2 was answered "write-off": qtyNonPassed reduces Quality Issue
 * and goes nowhere else, so Stock on Hand drops by that amount.
 */
export interface BinDelta {
  availQty: number;
  qtyIssue: number;
  qualityIssue: number;
  /** Set the bucket to exactly 0 rather than applying a delta. */
  zeroQtyIssue?: boolean;
}

export function stockEffect(
  type: InventoryAdjustmentType,
  line: { qtyAdjustment: number; qtyPassed: number; qtyNonPassed: number },
): BinDelta {
  switch (type) {
    // Quantity Issue is cleared entirely; available is reduced on the Oracle side.
    case 'DiscrepancyQuantity':
      return { availQty: 0, qtyIssue: 0, qualityIssue: 0, zeroQtyIssue: true };

    // Oracle-only. No WMS bucket moves (see the note above).
    case 'DiscrepancyQuality':
      return { availQty: 0, qtyIssue: 0, qualityIssue: 0 };

    case 'QualityAdjustment':
      return {
        availQty: line.qtyPassed,
        qtyIssue: 0,
        qualityIssue: -(line.qtyPassed + line.qtyNonPassed),
      };

    default:
      return { availQty: line.qtyAdjustment, qtyIssue: 0, qualityIssue: 0 };
  }
}
