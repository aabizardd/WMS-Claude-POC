import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';

// Available stock below this (but > 0) counts as "low stock". Heuristic — the
// WMS has no per-material reorder point yet.
const LOW_STOCK_THRESHOLD = 10;

type Bucket = { date: string; count: number };

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // Warehouse scope: admins with no active warehouse see everything; otherwise
  // scope to the active/own warehouse. Mirrors the CurrentUser semantics.
  private whScope(user: AuthUser): { warehouseId?: string } {
    if (user.role === 'admin') {
      return user.warehouseId ? { warehouseId: user.warehouseId } : {};
    }
    return { warehouseId: user.warehouseId ?? '__none__' };
  }

  private rangeStart(days: number): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  }

  // Bucket a list of dates into one count per calendar day across the window.
  private bucketByDay(dates: Date[], days: number): Bucket[] {
    const start = this.rangeStart(days);
    const buckets: Bucket[] = [];
    const index = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      index.set(key, buckets.length);
      buckets.push({ date: key, count: 0 });
    }
    for (const dt of dates) {
      const key = new Date(dt).toISOString().slice(0, 10);
      const i = index.get(key);
      if (i !== undefined) buckets[i].count += 1;
    }
    return buckets;
  }

  private countByStatus<T extends { status: string; _count: { _all: number } }>(
    rows: T[],
  ) {
    return rows.map((r) => ({ status: String(r.status), count: r._count._all }));
  }

  async summary(user: AuthUser, days: number) {
    const wh = this.whScope(user);
    const since = this.rangeStart(days);
    const rangeWh = { ...wh, createdAt: { gte: since } };

    const [
      // KPIs / inbound
      grInRange,
      grOpen,
      grStatus,
      putawayStatus,
      mrnCount,
      putawayCount,
      grDates,
      // outbound
      soInRange,
      soPending,
      soStatus,
      pickingStatus,
      packingStatus,
      deliveryStatus,
      pickingCount,
      packingCount,
      deliveryCount,
      deliveryDates,
      // quality
      adjPending,
      adjStatus,
      adjType,
      discInRange,
      discByType,
      discBySource,
      complaintOpen,
      complaintStatus,
      // ops
      syncStatus,
      syncLast,
      // aging
      grAging,
      pickAging,
      // inventory (single fetch, reduced in JS)
      inventory,
    ] = await Promise.all([
      this.prisma.goodsReceive.count({ where: rangeWh }),
      this.prisma.goodsReceive.count({
        where: { ...wh, status: { notIn: ['Closed'] } },
      }),
      this.prisma.goodsReceive.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.putaway.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.mrn.count({ where: rangeWh }),
      this.prisma.putaway.count({ where: rangeWh }),
      this.prisma.goodsReceive.findMany({
        where: rangeWh,
        select: { createdAt: true },
      }),

      this.prisma.salesOrder.count({ where: rangeWh }),
      this.prisma.salesOrder.count({ where: { ...wh, deliveryStatus: 'Open' } }),
      this.prisma.salesOrder.groupBy({
        by: ['deliveryStatus'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.picking.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.packing.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.delivery.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.picking.count({ where: rangeWh }),
      this.prisma.packing.count({ where: rangeWh }),
      this.prisma.delivery.count({ where: rangeWh }),
      this.prisma.delivery.findMany({
        where: rangeWh,
        select: { createdAt: true },
      }),

      this.prisma.inventoryAdjustment.count({
        where: { ...wh, status: 'PendingApproval' },
      }),
      this.prisma.inventoryAdjustment.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.inventoryAdjustment.groupBy({
        by: ['adjustmentType'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.discrepancy.count({ where: rangeWh }),
      this.prisma.discrepancy.groupBy({
        by: ['discrepancyType'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.discrepancy.groupBy({
        by: ['discrepancyFrom'],
        where: wh,
        _count: { _all: true },
      }),
      this.prisma.complaint.count({ where: { ...wh, status: 'Open' } }),
      this.prisma.complaint.groupBy({
        by: ['status'],
        where: wh,
        _count: { _all: true },
      }),

      this.prisma.syncLog.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.syncLog.findMany({
        distinct: ['module'],
        orderBy: { createdAt: 'desc' },
        select: { module: true, status: true, createdAt: true },
      }),

      this.prisma.goodsReceive.count({
        where: {
          ...wh,
          status: { notIn: ['Closed'] },
          createdAt: { lt: this.daysAgo(3) },
        },
      }),
      this.prisma.picking.count({
        where: {
          ...wh,
          status: { notIn: ['Closed'] },
          createdAt: { lt: this.daysAgo(3) },
        },
      }),

      this.prisma.inventoryManagement.findMany({
        where: wh,
        select: {
          materialCode: true,
          material: { select: { materialName: true } },
          warehouse: { select: { name: true } },
          qtyCommitted: true,
          qtyInTransit: true,
          binStocks: {
            select: {
              availQty: true,
              reservedQty: true,
              qtyIssue: true,
              qualityIssue: true,
            },
          },
        },
      }),
    ]);

    // ---- Inventory reduction ----
    let onHandTotal = 0;
    let availableTotal = 0;
    let reservedTotal = 0;
    let qtyIssueTotal = 0;
    let qualityIssueTotal = 0;
    let inTransitTotal = 0;
    let committedTotal = 0;
    let lowStock = 0;
    let zeroStock = 0;
    const byWarehouse = new Map<string, number>();
    const materialOnHand: { code: string; name: string; on_hand: number }[] = [];

    for (const inv of inventory) {
      let avail = 0;
      let onHand = 0;
      for (const b of inv.binStocks) {
        avail += b.availQty;
        onHand += b.availQty + b.reservedQty + b.qtyIssue + b.qualityIssue;
        reservedTotal += b.reservedQty;
        qtyIssueTotal += b.qtyIssue;
        qualityIssueTotal += b.qualityIssue;
      }
      availableTotal += avail;
      onHandTotal += onHand;
      inTransitTotal += inv.qtyInTransit;
      committedTotal += inv.qtyCommitted;
      if (avail <= 0) zeroStock += 1;
      else if (avail < LOW_STOCK_THRESHOLD) lowStock += 1;

      const whName = inv.warehouse?.name ?? '—';
      byWarehouse.set(whName, (byWarehouse.get(whName) ?? 0) + onHand);
      materialOnHand.push({
        code: inv.materialCode,
        name: inv.material?.materialName ?? inv.materialCode,
        on_hand: onHand,
      });
    }
    availableTotal = round(availableTotal);

    const topMaterials = materialOnHand
      .sort((a, b) => b.on_hand - a.on_hand)
      .slice(0, 10)
      .map((m) => ({ ...m, on_hand: round(m.on_hand) }));

    const onHandByWarehouse = [...byWarehouse.entries()]
      .map(([warehouse, on_hand]) => ({ warehouse, on_hand: round(on_hand) }))
      .sort((a, b) => b.on_hand - a.on_hand);

    return {
      range_days: days,
      warehouse_id: wh.warehouseId ?? null,
      kpis: {
        goods_receive_period: grInRange,
        goods_receive_open: grOpen,
        sales_order_period: soInRange,
        sales_order_pending: soPending,
        sku_on_hand: inventory.filter((i) =>
          i.binStocks.some((b) => b.availQty > 0),
        ).length,
        on_hand_qty: round(onHandTotal),
        adjustment_pending: adjPending,
        discrepancy_period: discInRange,
        complaint_open: complaintOpen,
      },
      inbound: {
        throughput: this.bucketByDay(
          grDates.map((g) => g.createdAt),
          days,
        ),
        gr_status: this.countByStatus(grStatus),
        putaway_status: this.countByStatus(putawayStatus),
        funnel: [
          { stage: 'MRN', count: mrnCount },
          { stage: 'Goods Receive', count: grInRange },
          { stage: 'Putaway', count: putawayCount },
        ],
      },
      outbound: {
        throughput: this.bucketByDay(
          deliveryDates.map((d) => d.createdAt),
          days,
        ),
        funnel: [
          { stage: 'Sales Order', count: soInRange },
          { stage: 'Picking', count: pickingCount },
          { stage: 'Packing', count: packingCount },
          { stage: 'Delivery', count: deliveryCount },
        ],
        so_status: soStatus.map((r) => ({
          status: String(r.deliveryStatus),
          count: r._count._all,
        })),
        picking_status: this.countByStatus(pickingStatus),
        packing_status: this.countByStatus(packingStatus),
        delivery_status: this.countByStatus(deliveryStatus),
      },
      inventory: {
        on_hand_by_warehouse: onHandByWarehouse,
        top_materials: topMaterials,
        composition: [
          { bucket: 'Available', qty: availableTotal },
          { bucket: 'Reserved', qty: round(reservedTotal) },
          { bucket: 'In Transit', qty: round(inTransitTotal) },
          { bucket: 'Committed', qty: round(committedTotal) },
          { bucket: 'Qty Issue', qty: round(qtyIssueTotal) },
          { bucket: 'Quality Issue', qty: round(qualityIssueTotal) },
        ],
        low_stock: lowStock,
        zero_stock: zeroStock,
      },
      quality: {
        discrepancy_by_type: discByType.map((r) => ({
          type: String(r.discrepancyType),
          count: r._count._all,
        })),
        discrepancy_by_source: discBySource.map((r) => ({
          source: String(r.discrepancyFrom),
          count: r._count._all,
        })),
        adjustment_by_status: this.countByStatus(adjStatus),
        adjustment_by_type: adjType.map((r) => ({
          type: String(r.adjustmentType),
          count: r._count._all,
        })),
        complaint_status: this.countByStatus(complaintStatus),
      },
      ops: {
        sync_by_status: this.countByStatus(syncStatus),
        last_sync_per_module: syncLast.map((s) => ({
          module: s.module,
          status: String(s.status),
          at: s.createdAt,
        })),
        aging: [
          { label: 'GR open > 3d', count: grAging },
          { label: 'Picking open > 3d', count: pickAging },
        ],
      },
    };
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
