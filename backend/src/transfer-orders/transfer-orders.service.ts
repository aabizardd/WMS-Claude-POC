import { Injectable, NotFoundException } from '@nestjs/common';
import { parseDateRange } from '../common/date-range.util';
import { usableBinStockWhere } from '../common/frozen-bins';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { paginationMeta } from '../common/pagination';
import { QueryTransferOrderDto } from './dto/query-transfer-order.dto';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type ToOrder = Prisma.TransferOrderOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => ToOrder> = {
  tran_id: (d) => ({ tranId: d }),
  tran_date: (d) => ({ tranDate: d }),
  status_name: (d) => ({ statusName: d }),
  oracle_id: (d) => ({ oracleId: d }),
  ownership: (d) => ({ warehouse: { subsidiaryName: d } }),
  created_by: (d) => ({ createdBy: d }),
  from_location: (d) => ({ fromLocationName: d }),
  to_location: (d) => ({ toLocationName: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: ToOrder = { lastModified: 'desc' };

/** A line's resolved WMS material (lines carry only its id). */
type MatInfo = {
  materialName: string;
  materialCode: string;
  primaryUom?: { uomCode: string } | null;
};

/** Orders only reach WMS through the Oracle sync, which is who last changed them. */
const SYNC_ACTOR = 'ERP Sync';

const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

/**
 * List filters, one per field. Several values on one field are OR-ed; fields
 * are AND-ed. Part Number looks inside the lines: the Oracle item name carries
 * the material code.
 */
const TO_FILTERS: Record<string, (v: string) => Prisma.TransferOrderWhereInput> = {
  material_code: (v) => ({ items: { some: { itemName: ci(v) } } }),
  from_warehouse_id: (v) => ({ warehouseId: v }),
  created_at: (v) => ({ createdAt: parseDateRange(v) }),
  tran_id: (v) => ({ tranId: ci(v) }),
  to_warehouse_id: (v) => ({ toWarehouseId: v }),
  // Free text: the origin's WMS warehouse or Oracle location name.
  from_warehouse_name: (v) => ({
    OR: [{ warehouse: { name: ci(v) } }, { fromLocationName: ci(v) }],
  }),
  // Free text on the destination's Oracle location name.
  to_warehouse_name: (v) => ({ toLocationName: ci(v) }),
  oracle_id: (v) => ({ oracleId: ci(v) }),
  memo: (v) => ({ memo: ci(v) }),
};

const detailInclude = {
  warehouse: { select: { id: true, name: true, subsidiaryName: true } },
  items: {
    orderBy: { lineNumber: 'asc' },
    include: {
      // What actually went out: lines of deliveries that were shipped.
      deliveryItems: { where: { delivery: { status: 'Closed' } }, select: { qty: true } },
    },
  },
} satisfies Prisma.TransferOrderInclude;

type ToDetail = Prisma.TransferOrderGetPayload<{ include: typeof detailInclude }>;
type ToLine = ToDetail['items'][number];

const stockKey = (warehouseId: string, materialId: string) => `${warehouseId}|${materialId}`;

@Injectable()
export class TransferOrdersService {
  constructor(private prisma: PrismaService) {}

  // Outbound from Transfer Stock is scoped to the FROM location's warehouse.
  private scopeWhere(scope: WarehouseScope): Prisma.TransferOrderWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  async findAll(query: QueryTransferOrderDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);

    const where: Prisma.TransferOrderWhereInput = { ...this.scopeWhere(scope) };
    if (query.status && query.status !== 'all') {
      where.statusName = query.status;
    }
    if (query.search) {
      where.OR = [
        { tranId: { contains: query.search, mode: 'insensitive' } },
        { toLocationName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const and: Prisma.TransferOrderWhereInput[] = [];
    for (const f of query.filters ?? []) {
      const build = TO_FILTERS[f.field];
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (build && values.length) and.push({ OR: values.map(build) });
    }
    if (and.length) where.AND = and;

    const withItems = query.include_items === 'true';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.transferOrder.count({ where }),
      this.prisma.transferOrder.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true, subsidiaryName: true } },
          _count: { select: { items: true } },
          ...(withItems ? { items: detailInclude.items } : {}),
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Lines carry only a material id; resolve materials and stock for every
    // row at once so the accordion reads like the detail's Material List.
    const withLines = rows.map((r) => ({
      warehouseId: r.warehouseId,
      items: 'items' in r ? (r.items as ToLine[]) : [],
    }));
    const matById = await this.materialsById(withLines.flatMap((r) => r.items));
    const available = await this.availableStock(withLines);
    const totals = await this.lineTotals(where);

    return {
      ...paginationMeta(total, page, limit, query),
      totals,
      rows: rows.map((r) => ({
        id: r.id,
        oracle_id: r.oracleId,
        tran_id: r.tranId,
        tran_date: r.tranDate,
        status_code: r.statusCode,
        status_name: r.statusName,
        from_location_name: r.fromLocationName,
        to_location_name: r.toLocationName,
        warehouse: r.warehouse ? { id: r.warehouse.id, name: r.warehouse.name } : null,
        ownership: r.warehouse?.subsidiaryName ?? null,
        memo: r.memo,
        item_count: r._count.items,
        created_by: r.createdBy,
        last_modified_by: SYNC_ACTOR,
        last_modified: r.lastModified,
        created_at: r.createdAt,
        ...('items' in r
          ? {
              items: (r.items as ToLine[]).map((l) =>
                this.serializeLine(l, matById, available, r.warehouseId),
              ),
            }
          : {}),
      })),
    };
  }

  private async materialsById(lines: { materialId: string | null }[]) {
    const ids = [...new Set(lines.map((l) => l.materialId).filter((x): x is string => !!x))];
    const mats = ids.length
      ? await this.prisma.material.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            materialName: true,
            materialCode: true,
            primaryUom: { select: { uomCode: true } },
          },
        })
      : [];
    return new Map<string, MatInfo>(mats.map((m) => [m.id, m]));
  }

  /**
   * Stock that can still be picked per origin warehouse + material (frozen KIT
   * stock excluded, as on the picking screen). Keyed by `stockKey`.
   */
  private async availableStock(
    orders: { warehouseId: string | null; items: { materialId: string | null }[] }[],
  ) {
    const pairs = orders.flatMap((o) =>
      o.warehouseId
        ? o.items
            .filter((l) => l.materialId)
            .map((l) => ({ warehouseId: o.warehouseId as string, materialId: l.materialId as string }))
        : [],
    );
    const available = new Map<string, number>();
    if (!pairs.length) return available;
    const invs = await this.prisma.inventoryManagement.findMany({
      where: { OR: pairs },
      select: {
        warehouseId: true,
        materialId: true,
        binStocks: { where: usableBinStockWhere(), select: { availQty: true } },
      },
    });
    for (const inv of invs) {
      if (!inv.materialId || !inv.warehouseId) continue;
      const key = stockKey(inv.warehouseId, inv.materialId);
      available.set(
        key,
        (available.get(key) ?? 0) + inv.binStocks.reduce((sum, b) => sum + b.availQty, 0),
      );
    }
    return available;
  }

  /**
   * Line quantities summed over every order matching the list filters (not
   * only the current page), worked out the same way as the detail's columns.
   * Available Qty is left out: it is stock per material, not per line.
   */
  private async lineTotals(where: Prisma.TransferOrderWhereInput) {
    const lineWhere = { transferOrder: where };
    const [lines, delivered] = await this.prisma.$transaction([
      this.prisma.transferOrderItem.findMany({
        where: lineWhere,
        select: { quantity: true, committed: true, remainingQty: true },
      }),
      this.prisma.deliveryItem.aggregate({
        where: { transferOrderItem: lineWhere, delivery: { status: 'Closed' } },
        _sum: { qty: true },
      }),
    ]);
    const totals = { request_qty: 0, given_qty: 0, remaining_qty: 0, actual_delivery: 0 };
    for (const l of lines) {
      totals.request_qty += l.quantity;
      totals.given_qty += Math.max(0, l.committed - l.remainingQty);
      totals.remaining_qty += l.remainingQty;
    }
    totals.actual_delivery = delivered._sum.qty ?? 0;
    return totals;
  }

  // Distinct statuses present (within scope) for the FE status filter.
  async getStatuses(scope: WarehouseScope) {
    const rows = await this.prisma.transferOrder.groupBy({
      by: ['statusName'],
      where: this.scopeWhere(scope),
      _count: { _all: true },
    });
    return rows
      .filter((r) => r.statusName)
      .map((r) => ({ status: r.statusName as string, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  async getLastSyncAt() {
    const latest = await this.prisma.transferOrder.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const to = await this.prisma.transferOrder.findFirst({
      where: { id, ...this.scopeWhere(scope) },
      include: detailInclude,
    });
    if (!to) throw new NotFoundException(`Transfer order ${id} not found`);

    const matById = await this.materialsById(to.items);
    const available = await this.availableStock([to]);

    return this.serializeDetail(to, matById, available);
  }

  private serializeDetail(
    to: ToDetail,
    matById: Map<string, MatInfo>,
    available: Map<string, number>,
  ) {
    return {
      id: to.id,
      oracle_id: to.oracleId,
      tran_id: to.tranId,
      tran_date: to.tranDate,
      status_code: to.statusCode,
      status_name: to.statusName,
      from_location_name: to.fromLocationName,
      to_location_name: to.toLocationName,
      warehouse: to.warehouse ? { id: to.warehouse.id, name: to.warehouse.name } : null,
      ownership: to.warehouse?.subsidiaryName ?? null,
      created_by: to.createdBy,
      last_modified_by: SYNC_ACTOR,
      memo: to.memo,
      date_created: to.dateCreated,
      last_modified: to.lastModified,
      created_at: to.createdAt,
      items: to.items.map((l) => this.serializeLine(l, matById, available, to.warehouseId)),
    };
  }

  private serializeLine(
    l: ToLine,
    matById: Map<string, MatInfo>,
    available: Map<string, number>,
    warehouseId: string | null,
  ) {
    const mat = l.materialId ? matById.get(l.materialId) : null;
    return {
      id: l.id,
      line_number: l.lineNumber,
      item_oracle_id: l.itemOracleId,
      item_name: l.itemName,
      material_name: mat?.materialName ?? null,
      material_code: mat?.materialCode ?? null,
      description: l.description,
      quantity: l.quantity,
      committed: l.committed,
      backordered: l.backordered,
      shipped: l.shipped,
      picked: l.picked,
      packed: l.packed,
      fulfilled: l.fulfilled,
      received: l.received,
      from_location_name: l.fromLocationName,
      material_id: l.materialId,
      uom: mat?.primaryUom?.uomCode ?? null,
      available_qty:
        warehouseId && l.materialId ? (available.get(stockKey(warehouseId, l.materialId)) ?? 0) : 0,
      // Already sent to picking: committed qty no longer remaining.
      given_qty: Math.max(0, l.committed - l.remainingQty),
      remaining_qty: l.remainingQty,
      actual_delivery: l.deliveryItems.reduce((sum, d) => sum + d.qty, 0),
    };
  }
}
