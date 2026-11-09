import type { Writable } from 'stream';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from './xlsx-export';

/** Which inbound Request list an export comes from. */
export type RequestKind = 'PO' | 'CR';

/**
 * One export row: a Request (PO / CR) header, one of its lines, and one Goods
 * Receive line made from it — or no GR (empty columns) when none was made yet.
 */
export interface RequestGrExportRow {
  /** The Request's own id, to count documents. */
  doc_id: string;
  status: string | null;
  transaction_id: string | null;
  erp_doc_id: string | null;
  /** CR only. */
  so_return_number?: string | null;
  ownership: string | null;
  /** Vendor (PO) or customer (CR). */
  party: string | null;
  warehouse: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: Date | null;
  last_modified_by: string | null;
  last_modified: Date | null;
  line: {
    no: number;
    line_number: number | null;
    material_code: string | null;
    material_name: string | null;
    material_type: string | null;
    material_category: string | null;
    uom: string | null;
    request_qty: number;
    receive_qty: number;
    remain_qty: number;
  } | null;
  gr: {
    gr_number: string;
    status: string;
    bin: string | null;
    planned_qty: number;
    actual_qty: number;
    putaway_qty: number;
    remain_qty: number;
    created_by: string | null;
    created_at: Date;
    received_at: Date | null;
  } | null;
}

type Row = RequestGrExportRow;
const at = (d: Date | null | undefined) => (d ? wibDateTimeMinutes(d) : null);
const words = (v: string) => v.replace(/([a-z])([A-Z])/g, '$1 $2');

/** The Request list's columns, then its accordion's, then the GR's — one sheet, side by side. */
function columns(kind: RequestKind): ExportColumn<Row>[] {
  const isCr = kind === 'CR';
  return [
    { header: 'Status', width: 18, value: (r) => r.status },
    { header: 'Transaction ID', width: 20, value: (r) => r.transaction_id },
    { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
    ...(isCr ? [{ header: 'SO Return Number', width: 22, value: (r: Row) => r.so_return_number ?? null }] : []),
    { header: 'Ownership', width: 29, value: (r) => r.ownership },
    { header: isCr ? 'Customer Name' : 'Vendor Name', width: 30, value: (r) => r.party },
    { header: 'Warehouse Name', width: 24, value: (r) => r.warehouse },
    { header: 'Memo', width: 30, value: (r) => r.memo },
    { header: 'Created By', width: 20, value: (r) => r.created_by },
    { header: 'Created At', width: 18, value: (r) => at(r.created_at) },
    { header: 'Last Modified By', width: 20, value: (r) => r.last_modified_by },
    { header: 'Last Modified At', width: 18, value: (r) => at(r.last_modified) },
    { header: 'No', width: 6, value: (r) => r.line?.no ?? null },
    { header: 'ERP Line Number', width: 16, value: (r) => r.line?.line_number ?? null },
    { header: 'Material Code', width: 24, value: (r) => r.line?.material_code ?? null },
    { header: 'Material Name', width: 40, value: (r) => r.line?.material_name ?? null },
    { header: 'Material Type', width: 15, value: (r) => r.line?.material_type ?? null },
    { header: 'Material Category', width: 19, value: (r) => r.line?.material_category ?? null },
    { header: 'UoM', width: 8, value: (r) => r.line?.uom ?? null },
    { header: 'Request Quantity', width: 16, value: (r) => r.line?.request_qty ?? null },
    { header: 'Receive Quantity', width: 16, value: (r) => r.line?.receive_qty ?? null },
    { header: 'Remain Quantity', width: 16, value: (r) => r.line?.remain_qty ?? null },
    { header: 'GR ID', width: 20, value: (r) => r.gr?.gr_number ?? null },
    { header: 'GR Status', width: 13, value: (r) => (r.gr ? words(r.gr.status) : null) },
    { header: 'GR Bin', width: 22, value: (r) => r.gr?.bin ?? null },
    { header: 'GR Planned Qty', width: 15, value: (r) => r.gr?.planned_qty ?? null },
    { header: 'GR Actual Qty', width: 14, value: (r) => r.gr?.actual_qty ?? null },
    { header: 'GR Putaway Qty', width: 15, value: (r) => r.gr?.putaway_qty ?? null },
    { header: 'GR Remain Qty', width: 14, value: (r) => r.gr?.remain_qty ?? null },
    { header: 'GR Created By', width: 20, value: (r) => r.gr?.created_by ?? null },
    { header: 'GR Created At', width: 18, value: (r) => at(r.gr?.created_at) },
    { header: 'GR Received At', width: 18, value: (r) => at(r.gr?.received_at) },
  ];
}

/** "po_request_gr_export_20261109_101502.xlsx" (WIB). */
export function requestGrExportFileName(kind: RequestKind, now = new Date()) {
  const t = wibParts(now);
  return `${kind.toLowerCase()}_request_gr_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the one-sheet workbook to `out`: white headers on indigo, frozen. */
export function writeRequestGrXlsx(kind: RequestKind, rows: AsyncIterable<Row[]>, out: Writable) {
  return writeXlsx(out, [{ name: kind, columns: columns(kind), rows }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}

/** A GR line's quantities: putaway / remain only exist once the GR is received (Closed). */
export function grLineQty(it: { qty: number; qtyActual: number; qtyRemaining: number }, received: boolean) {
  return {
    planned_qty: it.qty,
    actual_qty: it.qtyActual,
    putaway_qty: received ? Math.max(0, it.qtyActual - it.qtyRemaining) : 0,
    remain_qty: received ? it.qtyRemaining : 0,
  };
}

/** The GR lines of a Request line, as export rows' `gr` (oldest GR first). */
export const grItemSelect = {
  qty: true,
  qtyActual: true,
  qtyRemaining: true,
  bin: { select: { binLabel: true } },
  goodsReceive: {
    select: { grNumber: true, status: true, createdAt: true, updatedAt: true, createdBy: { select: { name: true } } },
  },
} as const;

export function grOf(it: {
  qty: number;
  qtyActual: number;
  qtyRemaining: number;
  bin: { binLabel: string | null } | null;
  goodsReceive: { grNumber: string; status: string; createdAt: Date; updatedAt: Date; createdBy: { name: string } | null };
}): NonNullable<Row['gr']> {
  const received = it.goodsReceive.status === 'Closed';
  return {
    gr_number: it.goodsReceive.grNumber,
    status: it.goodsReceive.status,
    bin: it.bin?.binLabel ?? null,
    ...grLineQty(it, received),
    created_by: it.goodsReceive.createdBy?.name ?? null,
    created_at: it.goodsReceive.createdAt,
    received_at: received ? it.goodsReceive.updatedAt : null,
  };
}

/** Counts what an export would hold: documents (Requests with a row) and rows. */
export async function countRequestGrRows(rows: AsyncIterable<Row[]>) {
  const docs = new Set<string>();
  let n = 0;
  for await (const batch of rows) {
    n += batch.length;
    for (const r of batch) docs.add(r.doc_id);
  }
  return { documents: docs.size, rows: n };
}
