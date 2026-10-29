import type { Writable } from 'stream';
import { type ExportColumn, wibParts, writeXlsx } from '../common/xlsx-export';
import type { InventoryExportRow } from './inventory.service';

/**
 * Columns of WMS dev's Inventory List export ("inventory_details"), with its
 * single quantity split into the POC's quantity buckets.
 */
const col = (key: keyof InventoryExportRow, width: number): ExportColumn<InventoryExportRow> => ({
  header: key,
  width,
  value: (r) => r[key],
});
const COLUMNS = [
  col('material_code', 22),
  col('material_name', 34),
  col('warehouse_name', 32),
  col('bin_label', 22),
  col('stock_unit_cuom', 16),
  col('qty_on_hand', 18),
  col('qty_available', 18),
  col('qty_freeze', 18),
  col('qty_reserved', 18),
  col('qty_in_transit', 18),
];

/** "inventory_details-2026-10-29_131633-WIB.xlsx", as WMS dev names it. */
export function inventoryExportFileName(now = new Date()) {
  const t = wibParts(now);
  return `inventory_details-${t.y}-${t.m}-${t.d}_${t.hh}${t.mm}${t.ss}-WIB.xlsx`;
}

/** Streams the export workbook to `out`, one batch of rows at a time. */
export function writeInventoryXlsx(rows: AsyncIterable<InventoryExportRow[]>, out: Writable) {
  return writeXlsx(out, [{ name: 'Inventory Details', columns: COLUMNS, rows }]);
}
