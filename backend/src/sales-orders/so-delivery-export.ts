import type { Writable } from 'stream';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';

/**
 * Sales Order × Delivery Plan export: what each SO line asked for, what went
 * on delivery plans, what was actually delivered and on which SD number.
 *
 * - From the Sales Order list: every SO the list's filters match (any status,
 *   with or without a delivery plan), all their lines and all their plans.
 * - From the Delivery Plan list: only SOs with delivered qty — the shipped
 *   (Closed) plans the list's filters match, and the SO lines on them.
 */
export interface SoDeliveryScope {
  /** Which sales orders. */
  soWhere: Prisma.SalesOrderWhereInput;
  /** Restrict lines and plans to these deliveries (Delivery Plan export). */
  deliveryWhere?: Prisma.DeliveryWhereInput;
}

/**
 * One SO line on one delivery plan / SD (sheet "Sales Order"); a line with
 * no plan yet is one row with the delivery columns empty.
 */
export interface SoLineExportRow {
  so_status: string | null;
  transaction_id: string | null;
  so_id: string | null;
  erp_doc_id: string;
  so_date: string | null;
  ownership: string | null;
  warehouse: string | null;
  customer: string | null;
  memo: string | null;
  created_at: Date;
  last_modified: Date | null;
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
export interface DeliveryLineExportRow {
  transaction_id: string | null;
  so_id: string | null;
  erp_doc_id: string | null;
  so_status: string | null;
  customer: string | null;
  warehouse: string | null;
  ownership: string | null;
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
  created_at: Date;
  delivered_by: string | null;
  delivered_at: Date | null;
}

const BATCH = 200;
/** Oracle's location "JAWA : Jakarta - IEL" without the region. */
const place = (v: string | null | undefined) => (v ? v.replace(/^[^:]+:\s*/, '') : null);

const lineInclude = (deliveryWhere?: Prisma.DeliveryWhereInput) =>
  ({
    material: { select: { materialCode: true, materialName: true, primaryUom: { select: { uomCode: true } } } },
    salesOrder: {
      include: { warehouse: { select: { name: true, subsidiaryName: true } } },
    },
    deliveryItems: {
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
    },
  }) satisfies Prisma.SalesOrderItemInclude;

type Line = Prisma.SalesOrderItemGetPayload<{ include: ReturnType<typeof lineInclude> }>;

/** The SO lines in scope, oldest order first, in batches. */
async function* lines(prisma: PrismaService, scope: SoDeliveryScope): AsyncGenerator<Line[]> {
  const where: Prisma.SalesOrderItemWhereInput = {
    salesOrder: scope.soWhere,
    ...(scope.deliveryWhere ? { deliveryItems: { some: { delivery: scope.deliveryWhere } } } : {}),
  };
  for (let skip = 0; ; skip += BATCH) {
    const batch = await prisma.salesOrderItem.findMany({
      where,
      include: lineInclude(scope.deliveryWhere),
      orderBy: [{ salesOrder: { tranId: 'asc' } }, { lineNumber: 'asc' }],
      skip,
      take: BATCH,
    });
    if (batch.length) yield batch;
    if (batch.length < BATCH) return;
  }
}

const delivered = (d: Line['deliveryItems'][number]) => d.delivery.status === 'Closed';

/** SD Status of shipped qty Oracle has but no WMS delivery plan covers. */
const NO_SD = 'Shipped in Oracle (no SD)';

async function* soLineRows(prisma: PrismaService, scope: SoDeliveryScope): AsyncGenerator<SoLineExportRow[]> {
  for await (const batch of lines(prisma, scope)) {
    yield batch.flatMap((l): SoLineExportRow[] => {
      const so = l.salesOrder;
      const base = {
        so_status: so.statusName,
        transaction_id: so.tranId,
        so_id: so.outboundId,
        erp_doc_id: so.oracleId,
        so_date: so.tranDate,
        ownership: so.warehouse?.subsidiaryName ?? so.subsidiaryName,
        warehouse: so.warehouse?.name ?? place(so.locationName),
        customer: so.customerName,
        memo: so.memo,
        created_at: so.createdAt,
        last_modified: so.lastModified,
        line_number: l.lineNumber,
        material_code: l.material?.materialCode ?? l.itemName,
        material_name: l.material?.materialName ?? l.description,
        uom: l.material?.primaryUom?.uomCode ?? null,
        request_qty: l.quantity,
        given_qty: Math.max(0, l.quantity - l.remainingQty),
        remaining_qty: l.remainingQty,
      };
      // One row per delivery plan: a line picked in several pickings sits on
      // one plan as several items, which add up here.
      const perPlan = new Map<string, { d: Line['deliveryItems'][number]; qty: number }>();
      for (const d of l.deliveryItems) {
        const cur = perPlan.get(d.deliveryId);
        perPlan.set(d.deliveryId, { d: cur?.d ?? d, qty: (cur?.qty ?? 0) + (delivered(d) ? d.qty : 0) });
      }
      const rows: SoLineExportRow[] = [...perPlan.values()].map(({ d, qty }) => ({
        ...base,
        delivered_qty: qty,
        delivery_id: d.delivery.deliveryCode,
        sd_number: d.delivery.sdoId,
        sd_status: d.delivery.status,
        delivered_at: delivered(d) ? d.delivery.updatedAt : null,
      }));
      // SO export: what Oracle shipped beyond the SDs WMS knows (e.g. orders
      // fulfilled in Oracle directly) is one extra row without an SD, so the
      // line's Delivered Qty always adds up to Oracle's shipped.
      const onSds = rows.reduce((s, r) => s + r.delivered_qty, 0);
      const gap = scope.deliveryWhere ? 0 : l.shipped - onSds;
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

async function* deliveryLineRows(prisma: PrismaService, scope: SoDeliveryScope): AsyncGenerator<DeliveryLineExportRow[]> {
  for await (const batch of lines(prisma, scope)) {
    yield batch.flatMap((l) =>
      l.deliveryItems.map((d) => {
        const so = l.salesOrder;
        const isDelivered = delivered(d);
        return {
          transaction_id: so.tranId,
          so_id: so.outboundId,
          erp_doc_id: so.oracleId,
          so_status: so.statusName,
          customer: so.customerName,
          warehouse: so.warehouse?.name ?? place(so.locationName),
          ownership: so.warehouse?.subsidiaryName ?? so.subsidiaryName,
          line_number: l.lineNumber,
          material_code: d.materialCode ?? l.material?.materialCode ?? l.itemName,
          material_name: d.materialName ?? l.material?.materialName ?? l.description,
          uom: l.material?.primaryUom?.uomCode ?? null,
          request_qty: l.quantity,
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
          created_at: d.delivery.createdAt,
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


const SO_COLUMNS: ExportColumn<SoLineExportRow>[] = [
  { header: 'Transaction ID', width: 20, value: (r) => r.transaction_id },
  { header: 'SO ID', width: 17, value: (r) => r.so_id },
  { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
  { header: 'SO Status', width: 30, value: (r) => r.so_status },
  { header: 'SO Date', width: 12, value: (r) => day(r.so_date) },
  { header: 'Ownership', width: 29, value: (r) => r.ownership },
  { header: 'Warehouse', width: 22, value: (r) => r.warehouse },
  { header: 'Customer', width: 40, value: (r) => r.customer },
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
  { header: 'SO Created At', width: 18, value: (r) => at(r.created_at) },
  { header: 'SO Last Modified At', width: 19, value: (r) => at(r.last_modified) },
];

const DP_COLUMNS: ExportColumn<DeliveryLineExportRow>[] = [
  { header: 'Transaction ID', width: 20, value: (r) => r.transaction_id },
  { header: 'SO ID', width: 17, value: (r) => r.so_id },
  { header: 'ERP Doc ID', width: 12, value: (r) => r.erp_doc_id },
  { header: 'SO Status', width: 30, value: (r) => r.so_status },
  { header: 'Customer', width: 40, value: (r) => r.customer },
  { header: 'Warehouse', width: 22, value: (r) => r.warehouse },
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
  { header: 'SO Request Qty', width: 15, value: (r) => r.request_qty },
  { header: 'Delivery Qty', width: 13, value: (r) => r.plan_qty },
  { header: 'Delivered Qty', width: 14, value: (r) => r.delivered_qty },
  { header: 'Staging Bin', width: 16, value: (r) => r.staging_bin },
  { header: 'Picking Bin', width: 16, value: (r) => r.picking_bin },
  { header: 'Delivery Created By', width: 22, value: (r) => r.created_by },
  { header: 'Delivery Created At', width: 19, value: (r) => at(r.created_at) },
  { header: 'Delivered By', width: 22, value: (r) => r.delivered_by },
  { header: 'Delivered At', width: 18, value: (r) => at(r.delivered_at) },
];

/** "sales_order_delivery_export_20261030_141502.xlsx" (WIB). */
export function soDeliveryExportFileName(from: 'so' | 'dp', now = new Date()) {
  const t = wibParts(now);
  const kind = from === 'so' ? 'sales_order_delivery' : 'delivery_plan_sales_order';
  return `${kind}_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the two-sheet workbook to `out`: white headers on indigo, frozen. */
export function writeSoDeliveryXlsx(prisma: PrismaService, scope: SoDeliveryScope, out: Writable) {
  return writeXlsx(
    out,
    [
      { name: 'Sales Order', columns: SO_COLUMNS, rows: soLineRows(prisma, scope) },
      { name: 'Delivery Plan', columns: DP_COLUMNS, rows: deliveryLineRows(prisma, scope) },
    ],
    { fill: 'FF5166AE', font: 'FFFFFFFF', freeze: true },
  );
}
