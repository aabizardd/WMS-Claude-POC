import type { Writable } from 'stream';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';
import type { TransferOrderExportRow } from './transfer-orders.service';

type Row = TransferOrderExportRow;
const date = (d: Date | null) => (d ? wibDateTimeMinutes(d) : null);

/** WMS dev's "ITI TO" columns; empty cells stay blank, as there. */
const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Transfer Order ID', width: 19, value: (r) => r.tran_id },
  { header: 'Status', width: 37, value: (r) => r.status },
  { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
  { header: 'Origin Warehouse', width: 35, value: (r) => r.origin },
  { header: 'Destination Warehouse', width: 35, value: (r) => r.destination },
  { header: 'Transfer Order Created At', width: 27, value: (r) => date(r.created_at) },
  { header: 'Request Transfer Qty', width: 22, value: (r) => r.request_qty },
  { header: 'SD Number', width: 20, value: (r) => r.sd_number },
  { header: 'Packing ID', width: 21, value: (r) => r.packing_id },
  { header: 'From Bin', width: 34, value: (r) => r.from_bin },
  { header: 'Material Code', width: 45, value: (r) => r.material_code },
  { header: 'Material Name', width: 45, value: (r) => r.material_name },
  { header: 'ERP Line ID', width: 13, value: (r) => r.erp_line_id },
  { header: 'Staging Bin', width: 32, value: (r) => r.staging_bin },
  { header: 'UoM', width: 12, value: (r) => r.uom },
  { header: 'Quantity Shipped', width: 18, value: (r) => r.qty_shipped },
  { header: 'Qty Received', width: 14, value: (r) => r.qty_received },
  { header: 'Date Shipped', width: 18, value: (r) => date(r.date_shipped) },
  { header: 'Date Received', width: 18, value: (r) => date(r.date_received) },
];

/** "transfer_order_export_20261029_115041.xlsx", as WMS dev names it (WIB). */
export function transferOrderExportFileName(now = new Date()) {
  const t = wibParts(now);
  return `transfer_order_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the "ITI TO" workbook to `out`: white headers on indigo, frozen. */
export function writeTransferOrderXlsx(rows: AsyncIterable<Row[]>, out: Writable) {
  return writeXlsx(out, [{ name: 'ITI TO', columns: COLUMNS, rows }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}
