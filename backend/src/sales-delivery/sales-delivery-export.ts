import type { Writable } from 'stream';
import { type ExportColumn, wibDateTime, wibParts, writeXlsx } from '../common/xlsx-export';
import type { SalesDeliveryExportLine } from './sales-delivery.service';

type Line = SalesDeliveryExportLine;
/** WMS dev writes an empty value as "-". */
const text = (v: string | null | undefined) => (v && v.trim() ? v : '-');

/** WMS dev's "SDKawasan" columns; the two sheets differ only in three headers. */
function columns(isReturn: boolean): ExportColumn<Line>[] {
  return [
    { header: isReturn ? 'Sales Return Number' : 'Sales Delivery Number', width: 26, value: (r) => r.number },
    { header: 'Netsuite ID', width: 14, value: (r) => text(r.netsuite_id) },
    { header: 'Origin Location', width: 24, value: (r) => text(r.origin) },
    { header: 'Destination Location', width: 24, value: (r) => text(r.destination) },
    { header: 'Customer', width: 28, value: (r) => text(r.customer) },
    { header: 'Department', width: 20, value: (r) => text(r.department) },
    { header: 'Class', width: 24, value: (r) => text(r.class) },
    { header: 'Memo', width: 36, value: (r) => text(r.memo) },
    { header: 'Material Code', width: 22, value: (r) => text(r.material_code) },
    { header: 'Material Name', width: 32, value: (r) => text(r.material_name) },
    { header: 'Bin', width: 26, value: (r) => text(r.bin) },
    { header: isReturn ? 'Qty Returned' : 'Qty Delivered', width: 14, value: (r) => r.qty },
    { header: isReturn ? 'Created At' : 'Delivery At', width: 20, value: (r) => wibDateTime(r.created_at) },
    { header: 'Created By', width: 26, value: (r) => text(r.created_by) },
    { header: 'Remarks', width: 36, value: (r) => text(r.remarks) },
  ];
}

/** "SDKawasan-20260930-000000-20261029-235959.xlsx": the period it covers, in WIB. */
export function salesDeliveryExportFileName(from: Date, to: Date) {
  const f = wibParts(from);
  const t = wibParts(to);
  return `SDKawasan-${f.y}${f.m}${f.d}-${f.hh}${f.mm}${f.ss}-${t.y}${t.m}${t.d}-${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the two-sheet workbook (Sales Delivery, Sales Return) to `out`. */
export function writeSalesDeliveryXlsx(
  deliveries: AsyncIterable<Line[]>,
  returns: AsyncIterable<Line[]>,
  out: Writable,
) {
  return writeXlsx(out, [
    { name: 'Sales Delivery', columns: columns(false), rows: deliveries },
    { name: 'Sales Return', columns: columns(true), rows: returns },
  ]);
}
