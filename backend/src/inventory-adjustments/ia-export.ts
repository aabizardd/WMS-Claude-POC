import type { Writable } from 'stream';
import { type ExportColumn, wibDateTime, wibParts, writeXlsx } from '../common/xlsx-export';
import type { IaExportRow } from './inventory-adjustments.service';

type Row = IaExportRow;

const STATUS_LABELS: Record<string, string> = {
  WaitingApproval: 'Waiting Approval',
  WaitingOracleApproval: 'Waiting Oracle',
  RejectedByOracle: 'Rejected by Oracle',
};
// Quality Adjustment lines carry passed / non-passed qty instead of one signed
// adjustment qty; those are left out of the export, so its Qty Adjustment is empty.
const passedMode = (r: Row) => r.qty_mode === 'passed_non_passed';

/**
 * The Inventory Adjustment list's columns followed by its accordion's, flat
 * on one sheet: one row per list row (document and warehouse) and line.
 */
const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Status', width: 18, value: (r) => STATUS_LABELS[r.status] ?? r.status },
  { header: 'Adjustment ID', width: 20, value: (r) => r.adjustment_number },
  { header: 'Warehouse', width: 24, value: (r) => r.warehouse },
  { header: 'Type', width: 20, value: (r) => r.adjustment_type_label },
  { header: 'Bins', width: 8, value: (r) => r.bin_count },
  { header: 'Total Adjustment', width: 16, value: (r) => r.total_qty },
  { header: 'Class', width: 20, value: (r) => r.class_name },
  { header: 'Department', width: 20, value: (r) => r.department_name },
  { header: 'Ownership', width: 29, value: (r) => r.ownership },
  { header: 'Created By', width: 20, value: (r) => r.created_by },
  { header: 'Created At', width: 20, value: (r) => wibDateTime(r.created_at) },
  { header: 'No', width: 6, value: (r) => r.line?.no ?? null },
  { header: 'Material Code', width: 24, value: (r) => r.line?.material_code ?? null },
  { header: 'Material Name', width: 40, value: (r) => r.line?.material_name ?? null },
  { header: 'Bin Code', width: 16, value: (r) => r.line?.bin_code ?? null },
  { header: 'Bin Label', width: 22, value: (r) => r.line?.bin_label ?? null },
  { header: 'Before Adjustment', width: 18, value: (r) => r.line?.before_qty ?? null },
  { header: 'Qty Adjustment', width: 15, value: (r) => (r.line && !passedMode(r) ? r.line.qty_adjustment : null) },
];

/** "inventory_adjustment_export_20261103_101502.xlsx" (WIB). */
export function iaExportFileName(now = new Date()) {
  const t = wibParts(now);
  return `inventory_adjustment_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the one-sheet workbook to `out`: white headers on indigo, frozen. */
export function writeIaXlsx(rows: AsyncIterable<Row[]>, out: Writable) {
  return writeXlsx(out, [{ name: 'Inventory Adjustment', columns: COLUMNS, rows }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}
