import type { Writable } from 'stream';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';

/**
 * Sales Order × Delivery Plan export, on one sheet: what each SO line asked
 * for, what went on delivery plans, what was actually delivered and on which
 * SD number — the order, line and plan columns side by side.
 *
 * - From the Sales Order list: every SO the list's filters match (any status,
 *   with or without a delivery plan), all their lines and all their plans.
 * - From the SO Delivery Plan list: only orders with a delivery plan — every
 *   plan the list's filters match (Open or Closed), and the order lines on
 *   them. (The TO Delivery Plan list exports the TO list's "ITI TO" layout.)
 */
export interface SoDeliveryScope {
  /** Which orders. */
  soWhere: Prisma.SalesOrderWhereInput;
  /** Restrict lines and plans to these deliveries (Delivery Plan export). */
  deliveryWhere?: Prisma.DeliveryWhereInput;
}

/** Order header fields every row carries. */
interface OrderFields {
  status: string | null;
  transaction_id: string | null;
  /** WMS's outbound number (SO ID / TO ID). */
  order_id: string | null;
  erp_doc_id: string | null;
  order_date: string | null;
  ownership: string | null;
  /** SO: its warehouse; TO: the origin warehouse. */
  warehouse: string | null;
  /** SO: the customer; TO: the destination warehouse. */
  party: string | null;
  memo: string | null;
  created_at: Date;
  last_modified: Date | null;
}

/**
 * One row: an SO line on one delivery plan item (a line picked in several
 * pickings sits on a plan as several items, one row each). A line with no
 * plan yet is one row with the delivery columns empty; on the SO list's
 * export, what Oracle shipped beyond the SDs WMS knows is one more row
 * without an SD.
 */
export interface SoDeliveryExportRow extends OrderFields {
  line_number: number;
  material_code: string | null;
  material_name: string | null;
  uom: string | null;
  request_qty: number;
  given_qty: number;
  remaining_qty: number;
  delivery_id: string | null;
  sd_number: string | null;
  /** Open / Delivered, or NO_SD for Oracle-only shipments; null without a plan. */
  delivery_status: string | null;
  packing_id: string | null;
  picking_id: string | null;
  plan_qty: number | null;
  delivered_qty: number;
  staging_bin: string | null;
  picking_bin: string | null;
  created_by: string | null;
  delivery_created_at: Date | null;
  delivered_by: string | null;
  delivered_at: Date | null;
}

const BATCH = 200;
/** Oracle's location "JAWA : Jakarta - IEL" without the region. */
const place = (v: string | null | undefined) => (v ? v.replace(/^[^:]+:\s*/, '') : null);

const deliveryItemsArgs = (deliveryWhere?: Prisma.DeliveryWhereInput) =>
  ({
    where: deliveryWhere ? { delivery: deliveryWhere } : undefined,
    include: {
      delivery: {
        select: {
          deliveryCode: true,
          sdoId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { name: true } },
          updatedBy: { select: { name: true } },
        },
      },
      bin: { select: { binLabel: true } },
      packing: { select: { packingCode: true } },
      pickingItem: { select: { bin: { select: { binLabel: true } }, picking: { select: { pickingCode: true } } } },
    },
    orderBy: { createdAt: 'asc' as const },
  }) satisfies Prisma.SalesOrderItem$deliveryItemsArgs;

type DItem = Prisma.DeliveryItemGetPayload<ReturnType<typeof deliveryItemsArgs>>;

/** An SO line, with its delivery plan items. */
interface Line {
  order: OrderFields;
  line_number: number;
  material_code: string | null;
  material_name: string | null;
  uom: string | null;
  request_qty: number;
  given_qty: number;
  remaining_qty: number;
  /** Oracle's shipped qty of the line. */
  shipped: number;
  deliveryItems: DItem[];
}

/** The SO lines in scope, oldest order first, in batches. */
async function* soLines(prisma: PrismaService, scope: SoDeliveryScope): AsyncGenerator<Line[]> {
  const where: Prisma.SalesOrderItemWhereInput = {
    salesOrder: scope.soWhere,
    ...(scope.deliveryWhere ? { deliveryItems: { some: { delivery: scope.deliveryWhere } } } : {}),
  };
  for (let skip = 0; ; skip += BATCH) {
    const batch = await prisma.salesOrderItem.findMany({
      where,
      include: {
        material: { select: { materialCode: true, materialName: true, primaryUom: { select: { uomCode: true } } } },
        salesOrder: { include: { warehouse: { select: { name: true, subsidiaryName: true } } } },
        deliveryItems: deliveryItemsArgs(scope.deliveryWhere),
      },
      orderBy: [{ salesOrder: { tranId: 'asc' } }, { lineNumber: 'asc' }],
      skip,
      take: BATCH,
    });
    if (batch.length) {
      yield batch.map((l) => {
        const so = l.salesOrder;
        return {
          order: {
            status: so.statusName,
            transaction_id: so.tranId,
            order_id: so.outboundId,
            erp_doc_id: so.oracleId,
            order_date: so.tranDate,
            ownership: so.warehouse?.subsidiaryName ?? so.subsidiaryName,
            warehouse: so.warehouse?.name ?? place(so.locationName),
            party: so.customerName,
            memo: so.memo,
            created_at: so.createdAt,
            last_modified: so.lastModified,
          },
          line_number: l.lineNumber,
          material_code: l.material?.materialCode ?? l.itemName,
          material_name: l.material?.materialName ?? l.description,
          uom: l.material?.primaryUom?.uomCode ?? null,
          request_qty: l.quantity,
          given_qty: Math.max(0, l.quantity - l.remainingQty),
          remaining_qty: l.remainingQty,
          shipped: l.shipped,
          deliveryItems: l.deliveryItems,
        };
      });
    }
    if (batch.length < BATCH) return;
  }
}

const delivered = (d: DItem) => d.delivery.status === 'Closed';

/** SD Status of shipped qty Oracle has but no WMS delivery plan covers. */
const NO_SD = 'Shipped in Oracle (no SD)';

/** No delivery columns: a line without a plan, or Oracle's shipped gap. */
const NO_DELIVERY = {
  delivery_id: null,
  sd_number: null,
  packing_id: null,
  picking_id: null,
  plan_qty: null,
  staging_bin: null,
  picking_bin: null,
  created_by: null,
  delivery_created_at: null,
  delivered_by: null,
  delivered_at: null,
};

/**
 * The sheet's rows. `oracleGap` adds, for the order-list export, what Oracle
 * shipped beyond the SDs WMS knows (e.g. orders fulfilled in Oracle directly)
 * as one extra row without an SD, so a line's Delivered Qty adds up to Oracle.
 */
async function* soDeliveryRows(lines: AsyncGenerator<Line[]>, oracleGap: boolean): AsyncGenerator<SoDeliveryExportRow[]> {
  for await (const batch of lines) {
    yield batch.flatMap((l): SoDeliveryExportRow[] => {
      const base = {
        ...l.order,
        line_number: l.line_number,
        material_code: l.material_code,
        material_name: l.material_name,
        uom: l.uom,
        request_qty: l.request_qty,
        given_qty: l.given_qty,
        remaining_qty: l.remaining_qty,
      };
      const rows: SoDeliveryExportRow[] = l.deliveryItems.map((d) => {
        const isDelivered = delivered(d);
        return {
          ...base,
          material_code: d.materialCode ?? l.material_code,
          material_name: d.materialName ?? l.material_name,
          delivery_id: d.delivery.deliveryCode,
          sd_number: d.delivery.sdoId,
          delivery_status: isDelivered ? 'Delivered' : 'Open',
          packing_id: d.packing?.packingCode ?? null,
          picking_id: d.pickingItem?.picking?.pickingCode ?? null,
          plan_qty: d.qty,
          delivered_qty: isDelivered ? d.qty : 0,
          staging_bin: d.bin?.binLabel ?? null,
          picking_bin: d.pickingItem?.bin?.binLabel ?? null,
          created_by: d.delivery.createdBy?.name ?? null,
          delivery_created_at: d.delivery.createdAt,
          // Shipping (Generate Shipment) is the delivery's last change.
          delivered_by: isDelivered ? (d.delivery.updatedBy?.name ?? null) : null,
          delivered_at: isDelivered ? d.delivery.updatedAt : null,
        };
      });
      const onSds = rows.reduce((sum, r) => sum + r.delivered_qty, 0);
      const gap = oracleGap ? l.shipped - onSds : 0;
      if (gap > 1e-9) rows.push({ ...base, ...NO_DELIVERY, delivery_status: NO_SD, delivered_qty: gap });
      if (!rows.length) rows.push({ ...base, ...NO_DELIVERY, delivery_status: null, delivered_qty: 0 });
      return rows;
    });
  }
}

const at = (d: Date | null) => (d ? wibDateTimeMinutes(d) : null);
/** "2026-10-22T00:00:00+07:00" (or "22/10/2026") as "2026-10-22". */
function day(v: string | null) {
  if (!v) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  if (iso) return iso[1];
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : v;
}

/** The SO list's columns, then the line's, then the delivery plan's — one sheet. */
const COLUMNS: ExportColumn<SoDeliveryExportRow>[] = [
  { header: 'Transaction ID', width: 20, value: (r) => r.transaction_id },
  { header: 'SO ID', width: 17, value: (r) => r.order_id },
  { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
  { header: 'SO Status', width: 30, value: (r) => r.status },
  { header: 'SO Date', width: 12, value: (r) => day(r.order_date) },
  { header: 'Ownership', width: 29, value: (r) => r.ownership },
  { header: 'Warehouse', width: 22, value: (r) => r.warehouse },
  { header: 'Customer', width: 40, value: (r) => r.party },
  { header: 'Memo', width: 30, value: (r) => r.memo },
  { header: 'Line No', width: 9, value: (r) => r.line_number },
  { header: 'Material Code', width: 24, value: (r) => r.material_code },
  { header: 'Material Name', width: 40, value: (r) => r.material_name },
  { header: 'UoM', width: 8, value: (r) => r.uom },
  { header: 'Request Qty', width: 12, value: (r) => r.request_qty },
  { header: 'Given Qty', width: 11, value: (r) => r.given_qty },
  { header: 'Remaining Qty', width: 14, value: (r) => r.remaining_qty },
  { header: 'Delivery ID', width: 20, value: (r) => r.delivery_id },
  { header: 'SD Number', width: 20, value: (r) => r.sd_number },
  { header: 'Delivery Status', width: 26, value: (r) => r.delivery_status },
  { header: 'Packing ID', width: 20, value: (r) => r.packing_id },
  { header: 'Picking ID', width: 20, value: (r) => r.picking_id },
  { header: 'Delivery Qty', width: 13, value: (r) => r.plan_qty },
  { header: 'Delivered Qty', width: 14, value: (r) => r.delivered_qty },
  { header: 'Staging Bin', width: 16, value: (r) => r.staging_bin },
  { header: 'Picking Bin', width: 16, value: (r) => r.picking_bin },
  { header: 'Delivery Created By', width: 22, value: (r) => r.created_by },
  { header: 'Delivery Created At', width: 19, value: (r) => at(r.delivery_created_at) },
  { header: 'Delivered By', width: 22, value: (r) => r.delivered_by },
  { header: 'Delivered At', width: 18, value: (r) => at(r.delivered_at) },
  { header: 'SO Created At', width: 18, value: (r) => at(r.created_at) },
  { header: 'SO Last Modified At', width: 19, value: (r) => at(r.last_modified) },
];

/** "sales_order_delivery_export_20261030_141502.xlsx" (WIB). */
export function soDeliveryExportFileName(from: 'so' | 'dp' | 'to-dp', now = new Date()) {
  const t = wibParts(now);
  const kind = { so: 'sales_order_delivery', dp: 'delivery_plan_sales_order', 'to-dp': 'delivery_plan_transfer_order' }[from];
  return `${kind}_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

const STYLE = { fill: 'FF5166AE', font: 'FFFFFFFF', freeze: true };

/**
 * What the SO workbook would hold, before it is written: orders and rows,
 * counted by walking the same rows the file writes.
 */
export async function countSoDeliveryRows(prisma: PrismaService, scope: SoDeliveryScope) {
  const orders = new Set<string | null>();
  let rows = 0;
  for await (const batch of soDeliveryRows(soLines(prisma, scope), !scope.deliveryWhere)) {
    rows += batch.length;
    for (const r of batch) orders.add(r.transaction_id);
  }
  return { documents: orders.size, rows };
}

/** Streams the SO workbook (one sheet, "Sales Order") to `out`. */
export function writeSoDeliveryXlsx(prisma: PrismaService, scope: SoDeliveryScope, out: Writable) {
  return writeXlsx(
    out,
    [{ name: 'Sales Order', columns: COLUMNS, rows: soDeliveryRows(soLines(prisma, scope), !scope.deliveryWhere) }],
    STYLE,
  );
}
