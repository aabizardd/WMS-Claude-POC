import type { Writable } from 'stream';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';

/**
 * Order × Delivery Plan export: what each Sales / Transfer Order line asked
 * for, what went on delivery plans, what was actually delivered and on which
 * SD number.
 *
 * - From the Sales Order list: every SO the list's filters match (any status,
 *   with or without a delivery plan), all their lines and all their plans.
 * - From the Delivery Plan list (SO or TO): only orders with a delivery plan —
 *   every plan the list's filters match (Open or Closed), and the order lines
 *   on them.
 */
export type OrderKind = 'SO' | 'TO';

export interface SoDeliveryScope {
  /** Which orders. */
  soWhere: Prisma.SalesOrderWhereInput;
  /** Restrict lines and plans to these deliveries (Delivery Plan export). */
  deliveryWhere?: Prisma.DeliveryWhereInput;
}

export interface ToDeliveryScope {
  toWhere: Prisma.TransferOrderWhereInput;
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
 * One order line on one delivery plan / SD (first sheet); a line with no plan
 * yet is one row with the delivery columns empty.
 */
export interface OrderLineExportRow extends OrderFields {
  line_number: number;
  material_code: string | null;
  material_name: string | null;
  uom: string | null;
  request_qty: number;
  given_qty: number;
  remaining_qty: number;
  /** Delivered on this SD (0 while the plan is not shipped). */
  delivered_qty: number;
  delivery_id: string | null;
  sd_number: string | null;
  /** The delivery plan's status: Closed once shipped, else Open. */
  sd_status: string | null;
  delivered_at: Date | null;
}

/** One line of one delivery plan (sheet "Delivery Plan"). */
export interface DeliveryLineExportRow extends OrderFields {
  line_number: number | null;
  material_code: string | null;
  material_name: string | null;
  uom: string | null;
  request_qty: number | null;
  delivery_id: string;
  sd_number: string | null;
  delivery_status: string;
  packing_id: string | null;
  picking_id: string | null;
  plan_qty: number;
  delivered_qty: number;
  staging_bin: string | null;
  picking_bin: string | null;
  created_by: string | null;
  delivery_created_at: Date;
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

/** An SO or TO line, the way both sheets read it. */
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

/** The TO lines in scope, oldest order first, in batches. */
async function* toLines(prisma: PrismaService, scope: ToDeliveryScope): AsyncGenerator<Line[]> {
  const where: Prisma.TransferOrderItemWhereInput = {
    transferOrder: scope.toWhere,
    ...(scope.deliveryWhere ? { deliveryItems: { some: { delivery: scope.deliveryWhere } } } : {}),
  };
  for (let skip = 0; ; skip += BATCH) {
    const batch = await prisma.transferOrderItem.findMany({
      where,
      include: {
        transferOrder: { include: { warehouse: { select: { name: true, subsidiaryName: true } } } },
        deliveryItems: deliveryItemsArgs(scope.deliveryWhere),
      },
      orderBy: [{ transferOrder: { tranId: 'asc' } }, { lineNumber: 'asc' }],
      skip,
      take: BATCH,
    });
    if (batch.length) {
      // TO lines and headers carry only ids for the material and destination.
      const [mats, dests] = await Promise.all([
        prisma.material.findMany({
          where: { id: { in: [...new Set(batch.map((l) => l.materialId).filter((x): x is string => !!x))] } },
          select: { id: true, materialCode: true, materialName: true, primaryUom: { select: { uomCode: true } } },
        }),
        prisma.warehouse.findMany({
          where: {
            id: { in: [...new Set(batch.map((l) => l.transferOrder.toWarehouseId).filter((x): x is string => !!x))] },
          },
          select: { id: true, name: true },
        }),
      ]);
      const matById = new Map(mats.map((m) => [m.id, m]));
      const destById = new Map(dests.map((w) => [w.id, w.name]));
      yield batch.map((l) => {
        const to = l.transferOrder;
        const m = l.materialId ? matById.get(l.materialId) : undefined;
        return {
          order: {
            status: to.statusName,
            transaction_id: to.tranId,
            order_id: to.outboundId,
            erp_doc_id: to.oracleId,
            order_date: to.tranDate,
            ownership: to.warehouse?.subsidiaryName ?? null,
            warehouse: to.warehouse?.name ?? place(to.fromLocationName),
            party: (to.toWarehouseId && destById.get(to.toWarehouseId)) || place(to.toLocationName),
            memo: to.memo,
            created_at: to.createdAt,
            last_modified: to.lastModified,
          },
          line_number: l.lineNumber,
          material_code: m?.materialCode ?? l.itemName,
          material_name: m?.materialName ?? l.description,
          uom: m?.primaryUom?.uomCode ?? null,
          request_qty: l.quantity,
          // Already sent to picking: committed qty no longer remaining.
          given_qty: Math.max(0, l.committed - l.remainingQty),
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

/**
 * The first sheet. `oracleGap` adds, for the order-list export, what Oracle
 * shipped beyond the SDs WMS knows (e.g. orders fulfilled in Oracle directly)
 * as one extra row without an SD, so a line's Delivered Qty adds up to Oracle.
 */
async function* orderLineRows(lines: AsyncGenerator<Line[]>, oracleGap: boolean): AsyncGenerator<OrderLineExportRow[]> {
  for await (const batch of lines) {
    yield batch.flatMap((l): OrderLineExportRow[] => {
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
      // One row per delivery plan: a line picked in several pickings sits on
      // one plan as several items, which add up here.
      const perPlan = new Map<string, { d: DItem; qty: number }>();
      for (const d of l.deliveryItems) {
        const cur = perPlan.get(d.deliveryId);
        perPlan.set(d.deliveryId, { d: cur?.d ?? d, qty: (cur?.qty ?? 0) + (delivered(d) ? d.qty : 0) });
      }
      const rows: OrderLineExportRow[] = [...perPlan.values()].map(({ d, qty }) => ({
        ...base,
        delivered_qty: qty,
        delivery_id: d.delivery.deliveryCode,
        sd_number: d.delivery.sdoId,
        sd_status: d.delivery.status,
        delivered_at: delivered(d) ? d.delivery.updatedAt : null,
      }));
      const onSds = rows.reduce((s, r) => s + r.delivered_qty, 0);
      const gap = oracleGap ? l.shipped - onSds : 0;
      if (gap > 1e-9) {
        rows.push({ ...base, delivered_qty: gap, delivery_id: null, sd_number: null, sd_status: NO_SD, delivered_at: null });
      }
      if (!rows.length) {
        rows.push({ ...base, delivered_qty: 0, delivery_id: null, sd_number: null, sd_status: null, delivered_at: null });
      }
      return rows;
    });
  }
}

async function* deliveryLineRows(lines: AsyncGenerator<Line[]>): AsyncGenerator<DeliveryLineExportRow[]> {
  for await (const batch of lines) {
    yield batch.flatMap((l) =>
      l.deliveryItems.map((d) => {
        const isDelivered = delivered(d);
        return {
          ...l.order,
          line_number: l.line_number,
          material_code: d.materialCode ?? l.material_code,
          material_name: d.materialName ?? l.material_name,
          uom: l.uom,
          request_qty: l.request_qty,
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
      }),
    );
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

/** The order columns of either sheet, named for SO or TO. */
const LABELS: Record<OrderKind, { id: string; status: string; date: string; warehouse: string; party: string; request: string }> = {
  SO: { id: 'SO ID', status: 'SO Status', date: 'SO Date', warehouse: 'Warehouse', party: 'Customer', request: 'SO Request Qty' },
  TO: {
    id: 'TO ID',
    status: 'TO Status',
    date: 'TO Date',
    warehouse: 'Origin Warehouse',
    party: 'Destination Warehouse',
    request: 'TO Request Qty',
  },
};

function lineColumns(kind: OrderKind): ExportColumn<OrderLineExportRow>[] {
  const t = LABELS[kind];
  return [
    { header: 'Transaction ID', width: 20, value: (r) => r.transaction_id },
    { header: t.id, width: 17, value: (r) => r.order_id },
    { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
    { header: t.status, width: 30, value: (r) => r.status },
    { header: t.date, width: 12, value: (r) => day(r.order_date) },
    { header: 'Ownership', width: 29, value: (r) => r.ownership },
    { header: t.warehouse, width: 22, value: (r) => r.warehouse },
    { header: t.party, width: kind === 'SO' ? 40 : 24, value: (r) => r.party },
    { header: 'Memo', width: 30, value: (r) => r.memo },
    { header: 'Line No', width: 9, value: (r) => r.line_number },
    { header: 'Material Code', width: 24, value: (r) => r.material_code },
    { header: 'Material Name', width: 40, value: (r) => r.material_name },
    { header: 'UoM', width: 8, value: (r) => r.uom },
    { header: 'Request Qty', width: 12, value: (r) => r.request_qty },
    { header: 'Given Qty', width: 11, value: (r) => r.given_qty },
    { header: 'Remaining Qty', width: 14, value: (r) => r.remaining_qty },
    { header: 'Delivered Qty', width: 14, value: (r) => r.delivered_qty },
    { header: 'Delivery ID', width: 20, value: (r) => r.delivery_id },
    { header: 'SD Number', width: 20, value: (r) => r.sd_number },
    { header: 'SD Status', width: 26, value: (r) => r.sd_status },
    { header: 'Delivered At', width: 18, value: (r) => at(r.delivered_at) },
    { header: `${kind} Created At`, width: 18, value: (r) => at(r.created_at) },
    { header: `${kind} Last Modified At`, width: 19, value: (r) => at(r.last_modified) },
  ];
}

function deliveryColumns(kind: OrderKind): ExportColumn<DeliveryLineExportRow>[] {
  const t = LABELS[kind];
  return [
    { header: 'Transaction ID', width: 20, value: (r) => r.transaction_id },
    { header: t.id, width: 17, value: (r) => r.order_id },
    { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
    { header: t.status, width: 30, value: (r) => r.status },
    // SO: Customer, Warehouse; TO: Origin, Destination.
    ...(kind === 'SO'
      ? [
          { header: t.party, width: 40, value: (r: DeliveryLineExportRow) => r.party },
          { header: t.warehouse, width: 22, value: (r: DeliveryLineExportRow) => r.warehouse },
        ]
      : [
          { header: t.warehouse, width: 22, value: (r: DeliveryLineExportRow) => r.warehouse },
          { header: t.party, width: 24, value: (r: DeliveryLineExportRow) => r.party },
        ]),
    { header: 'Ownership', width: 29, value: (r) => r.ownership },
    { header: 'Delivery ID', width: 20, value: (r) => r.delivery_id },
    { header: 'SD Number', width: 20, value: (r) => r.sd_number },
    { header: 'Delivery Status', width: 15, value: (r) => r.delivery_status },
    { header: 'Packing ID', width: 20, value: (r) => r.packing_id },
    { header: 'Picking ID', width: 20, value: (r) => r.picking_id },
    { header: 'ERP Line', width: 9, value: (r) => r.line_number },
    { header: 'Material Code', width: 24, value: (r) => r.material_code },
    { header: 'Material Name', width: 40, value: (r) => r.material_name },
    { header: 'UoM', width: 8, value: (r) => r.uom },
    { header: t.request, width: 15, value: (r) => r.request_qty },
    { header: 'Delivery Qty', width: 13, value: (r) => r.plan_qty },
    { header: 'Delivered Qty', width: 14, value: (r) => r.delivered_qty },
    { header: 'Staging Bin', width: 16, value: (r) => r.staging_bin },
    { header: 'Picking Bin', width: 16, value: (r) => r.picking_bin },
    { header: 'Delivery Created By', width: 22, value: (r) => r.created_by },
    { header: 'Delivery Created At', width: 19, value: (r) => at(r.delivery_created_at) },
    { header: 'Delivered By', width: 22, value: (r) => r.delivered_by },
    { header: 'Delivered At', width: 18, value: (r) => at(r.delivered_at) },
  ];
}

/** "sales_order_delivery_export_20261030_141502.xlsx" (WIB). */
export function soDeliveryExportFileName(from: 'so' | 'dp' | 'to-dp', now = new Date()) {
  const t = wibParts(now);
  const kind = { so: 'sales_order_delivery', dp: 'delivery_plan_sales_order', 'to-dp': 'delivery_plan_transfer_order' }[from];
  return `${kind}_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

const STYLE = { fill: 'FF5166AE', font: 'FFFFFFFF', freeze: true };

/** Streams the SO workbook (sheets "Sales Order" and "Delivery Plan") to `out`. */
export function writeSoDeliveryXlsx(prisma: PrismaService, scope: SoDeliveryScope, out: Writable) {
  return writeXlsx(
    out,
    [
      { name: 'Sales Order', columns: lineColumns('SO'), rows: orderLineRows(soLines(prisma, scope), !scope.deliveryWhere) },
      { name: 'Delivery Plan', columns: deliveryColumns('SO'), rows: deliveryLineRows(soLines(prisma, scope)) },
    ],
    STYLE,
  );
}

/** Streams the TO workbook (sheets "Transfer Order" and "Delivery Plan") to `out`. */
export function writeToDeliveryXlsx(prisma: PrismaService, scope: ToDeliveryScope, out: Writable) {
  return writeXlsx(
    out,
    [
      { name: 'Transfer Order', columns: lineColumns('TO'), rows: orderLineRows(toLines(prisma, scope), !scope.deliveryWhere) },
      { name: 'Delivery Plan', columns: deliveryColumns('TO'), rows: deliveryLineRows(toLines(prisma, scope)) },
    ],
    STYLE,
  );
}
