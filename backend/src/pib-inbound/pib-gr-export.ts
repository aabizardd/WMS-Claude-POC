import type { Writable } from 'stream';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';
import type { PibGrExportRow } from './pib-inbound.service';

type Row = PibGrExportRow;

/**
 * An Oracle shipment date ("25/5/2026", d/m/yyyy) as WMS dev writes it
 * ("2026-05-25 00:00"); anything else is passed through unchanged.
 */
export function oracleDate(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return v;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} 00:00`;
}

/** WMS dev's "PIB" columns, with the shipment's Nomor Aju after ERP Doc ID. */
const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Status', width: 13, value: (r) => r.status.replace(/([a-z])([A-Z])/g, '$1 $2') },
  { header: 'Transaction ID', width: 16, value: (r) => r.transaction_id },
  { header: 'GR ID', width: 17, value: (r) => r.gr_number },
  { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
  { header: 'Nomor Aju', width: 22, value: (r) => r.aju_number },
  { header: 'Doc Type', width: 12, value: () => 'PIB' },
  { header: 'Supplier', width: 45, value: (r) => r.supplier },
  { header: 'Ownership', width: 29, value: (r) => r.ownership },
  { header: 'Warehouse', width: 15, value: (r) => r.warehouse },
  { header: 'Expected Shipping Date', width: 24, value: (r) => oracleDate(r.expected_shipping_date) },
  { header: 'Actual Shipping Date', width: 22, value: (r) => oracleDate(r.actual_shipping_date) },
  { header: 'Expected Delivery Date', width: 24, value: (r) => oracleDate(r.expected_delivery_date) },
  { header: 'Actual Delivery Date', width: 22, value: (r) => oracleDate(r.actual_delivery_date) },
  { header: 'Vessel Number', width: 32, value: (r) => r.vessel_number },
  { header: 'Bill of Lading', width: 16, value: (r) => r.bill_of_lading },
  { header: 'Port', width: 16, value: (r) => r.port },
  { header: 'Created By', width: 12, value: (r) => r.created_by },
  { header: 'Created At', width: 18, value: (r) => wibDateTimeMinutes(r.created_at) },
  // The POC does not record who last changed a GR yet.
  { header: 'Last Modified By', width: 25, value: () => null },
  { header: 'Last Modified At', width: 18, value: (r) => wibDateTimeMinutes(r.updated_at) },
  { header: 'Material Code', width: 26, value: (r) => r.material_code },
  { header: 'Material Name', width: 45, value: (r) => r.material_name },
  { header: 'UoM', width: 12, value: (r) => r.uom },
  { header: 'PO No', width: 20, value: (r) => r.po_number },
  { header: 'Planned Qty', width: 13, value: (r) => r.planned_qty },
  { header: 'Actual Qty', width: 12, value: (r) => r.actual_qty },
  { header: 'Putaway Qty', width: 13, value: (r) => r.putaway_qty },
];

/** "pib_goods_receive_export_20261029_162730.xlsx", as WMS dev names it (WIB). */
export function pibGrExportFileName(now = new Date()) {
  const t = wibParts(now);
  return `pib_goods_receive_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the "PIB" workbook to `out`: white headers on indigo, frozen. */
export function writePibGrXlsx(rows: AsyncIterable<Row[]>, out: Writable) {
  return writeXlsx(out, [{ name: 'PIB', columns: COLUMNS, rows }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}
