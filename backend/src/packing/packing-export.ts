import type { Writable } from 'stream';
import { type ExportColumn, wibDateTimeDmy, writeXlsx } from '../common/xlsx-export';

/** A packing's detail as the export reads it (see PackingService.findOne). */
export interface PackingExportDoc {
  packing_id: string;
  source_type: 'SALES_ORDER' | 'TRANSFER_ORDER';
  status: string;
  source_number: string | null;
  outbound_id: string | null;
  picking_id: string | null;
  ownership: string | null;
  location: string | null;
  customer: string | null;
  created_by: string | null;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
  items: {
    material_code: string | null;
    material_name: string | null;
    bin_label: string | null;
    picking_id: string | null;
    qty: number;
    actual_qty: number;
    uom: string | null;
    material_type: string | null;
    material_category: string | null;
  }[];
}

type Row = { doc: PackingExportDoc; no: number; item: PackingExportDoc['items'][number] };

/** Oracle's location "SULAWESI : IMIP - IEL" without the region. */
const place = (v: string | null) => (v ? v.replace(/^[^:]+:\s*/, '') : null);
const at = (d: Date | null) => (d ? wibDateTimeDmy(new Date(d)) : null);

/**
 * WMS dev's "Packing List" columns: the packing header repeated on every
 * material line. SO and TO differ only in the order ID and the parties.
 */
function columns(isTransfer: boolean): ExportColumn<Row>[] {
  return [
    { header: 'Status', width: 12, value: (r) => r.doc.status },
    { header: 'Transaction ID', width: isTransfer ? 16 : 20, value: (r) => r.doc.source_number },
    { header: isTransfer ? 'TO ID' : 'SO ID', width: isTransfer ? 16 : 17, value: (r) => r.doc.outbound_id },
    { header: 'Picking ID', width: 21, value: (r) => r.item.picking_id ?? r.doc.picking_id },
    { header: 'Packing ID', width: 21, value: (r) => r.doc.packing_id },
    { header: 'Ownership', width: 29, value: (r) => r.doc.ownership },
    ...(isTransfer
      ? [
          { header: 'Warehouse Name Origin', width: 23, value: (r: Row) => r.doc.location },
          { header: 'Warehouse Name Destination', width: 34, value: (r: Row) => place(r.doc.customer) },
          { header: 'Created By', width: 17, value: (r: Row) => r.doc.created_by },
        ]
      : [
          { header: 'Warehouse', width: 27, value: (r: Row) => r.doc.location },
          { header: 'Customer', width: 20, value: (r: Row) => r.doc.customer },
          { header: 'Created By', width: 12, value: (r: Row) => r.doc.created_by },
        ]),
    { header: 'Created At', width: 21, value: (r) => at(r.doc.created_at) },
    { header: 'Last Modified By', width: 18, value: (r) => r.doc.updated_by },
    // Only a packing someone has packed has a last change of its own.
    { header: 'Last Modified At', width: 21, value: (r) => (r.doc.updated_by ? at(r.doc.updated_at) : null) },
    { header: 'No', width: 12, value: (r) => r.no },
    { header: 'Material Code', width: 15, value: (r) => r.item.material_code },
    { header: 'Material Name', width: isTransfer ? 32 : 26, value: (r) => r.item.material_name },
    { header: 'Bin Label', width: isTransfer ? 18 : 23, value: (r) => r.item.bin_label },
    { header: 'Planned Quantity', width: 18, value: (r) => r.item.qty },
    { header: 'Actual Qty', width: 12, value: (r) => r.item.actual_qty },
    { header: 'UoM', width: 12, value: (r) => r.item.uom },
    { header: 'Material Type', width: 15, value: (r) => r.item.material_type },
    { header: 'Material Category', width: 19, value: (r) => r.item.material_category },
  ];
}

/** "packing_list_SO_PACK-20261103-00550.xlsx", as WMS dev names it. */
export function packingExportFileName(doc: Pick<PackingExportDoc, 'source_type' | 'packing_id'>) {
  return `packing_list_${doc.source_type === 'TRANSFER_ORDER' ? 'TO' : 'SO'}_${doc.packing_id}.xlsx`;
}

/** Streams the one-sheet "Packing List" workbook: white headers on indigo, frozen. */
export function writePackingXlsx(doc: PackingExportDoc, out: Writable) {
  async function* rows() {
    yield doc.items.map((item, i) => ({ doc, no: i + 1, item }));
  }
  return writeXlsx(out, [{ name: 'Packing List', columns: columns(doc.source_type === 'TRANSFER_ORDER'), rows: rows() }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}
