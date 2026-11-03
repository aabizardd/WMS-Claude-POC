import type { Writable } from 'stream';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';
import type { GrExportRow, InboundSource } from './transfer-inbound.service';

type Row = GrExportRow;
const at = (d: Date) => wibDateTimeMinutes(d);
const words = (v: string) => v.replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * The Goods Receive list's columns followed by its accordion's, flat on one
 * sheet. TO shows Origin and Destination Warehouse; PO its Warehouse.
 */
function columns(source: InboundSource): ExportColumn<Row>[] {
  const isTo = source === 'TO';
  return [
    { header: 'Status', width: 13, value: (r) => words(r.status) },
    { header: 'Transaction ID', width: 18, value: (r) => r.transaction_id },
    { header: 'GR ID', width: 20, value: (r) => r.gr_number },
    { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
    { header: 'Document Type', width: 16, value: (r) => r.document_type },
    { header: 'Ownership', width: 29, value: (r) => r.ownership },
    ...(isTo
      ? [
          { header: 'Origin Warehouse', width: 24, value: (r: Row) => r.origin_warehouse ?? null },
          { header: 'Destination Warehouse', width: 24, value: (r: Row) => r.warehouse },
        ]
      : [{ header: 'Warehouse', width: 24, value: (r: Row) => r.warehouse }]),
    { header: 'Created By', width: 20, value: (r) => r.created_by },
    { header: 'Created At', width: 18, value: (r) => at(r.created_at) },
    { header: 'Last Modified At', width: 18, value: (r) => at(r.updated_at) },
    { header: 'No', width: 6, value: (r) => r.line?.no ?? null },
    { header: 'ERP Line ID', width: 12, value: (r) => r.line?.line_number ?? null },
    { header: 'Material Code', width: 24, value: (r) => r.line?.material_code ?? null },
    { header: 'Material Name', width: 40, value: (r) => r.line?.material_name ?? null },
    { header: 'Material Type', width: 15, value: (r) => r.line?.material_type ?? null },
    { header: 'Material Category', width: 19, value: (r) => r.line?.material_category ?? null },
    { header: 'UoM', width: 8, value: (r) => r.line?.uom ?? null },
    { header: 'Planned Qty', width: 12, value: (r) => r.line?.planned_qty ?? null },
    { header: 'Actual Qty', width: 12, value: (r) => r.line?.actual_qty ?? null },
    { header: 'Putaway Qty', width: 12, value: (r) => r.line?.putaway_qty ?? null },
    { header: 'Remain Qty', width: 12, value: (r) => r.line?.remain_qty ?? null },
  ];
}

/** "to_goods_receive_export_20261103_101502.xlsx" (WIB). */
export function grExportFileName(source: InboundSource, now = new Date()) {
  const t = wibParts(now);
  return `${source.toLowerCase()}_goods_receive_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the one-sheet workbook to `out`: white headers on indigo, frozen. */
export function writeGrXlsx(source: InboundSource, rows: AsyncIterable<Row[]>, out: Writable) {
  return writeXlsx(out, [{ name: source, columns: columns(source), rows }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}
