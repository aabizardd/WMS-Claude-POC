import { Injectable, NotFoundException } from '@nestjs/common';
import { parseDateRange } from '../common/date-range.util';
import { usableBinStockWhere } from '../common/frozen-bins';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { paginationMeta } from '../common/pagination';
import { QueryTransferOrderDto } from './dto/query-transfer-order.dto';
import { inScope, scopeWhere } from '../common/warehouse-scope';

export interface WarehouseScope {
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
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

/** TOs not fulfilled yet have nothing to receive: left out of the inbound view. */
const NOT_INBOUND_STATUSES = ['Pending Approval', 'Pending Fulfillment'];

/** A line's resolved WMS material (lines carry only its id). */
type MatInfo = {
  materialName: string;
  materialCode: string;
  primaryUom?: { uomCode: string } | null;
  materialType?: { materialTypeName: string } | null;
  materialCategory?: { materialCategoryName: string } | null;
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
  },
} satisfies Prisma.TransferOrderInclude;

type ToDetail = Prisma.TransferOrderGetPayload<{ include: typeof detailInclude }>;
type ToLine = ToDetail['items'][number];

/** One row of the TO export: a TO line, or one shipped delivery line of it. */
export interface TransferOrderExportRow {
  tran_id: string | null;
  status: string | null;
  erp_doc_id: string;
  origin: string | null;
  destination: string | null;
  created_at: Date;
  request_qty: number;
  sd_number: string | null;
  packing_id: string | null;
  from_bin: string | null;
  material_code: string | null;
  material_name: string | null;
  erp_line_id: number;
  staging_bin: string | null;
  uom: string | null;
  qty_shipped: number | null;
  qty_received: number | null;
  date_shipped: Date | null;
  date_received: Date | null;
}

const stockKey = (warehouseId: string, materialId: string) => `${warehouseId}|${materialId}`;

@Injectable()
export class TransferOrdersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Outbound from Transfer Stock: a user sees a TO when its origin OR its
   * destination is one of their warehouses. Acting on it (Generate Picking)
   * stays with the origin — the picking service checks that.
   */
  private scopeWhere(scope: WarehouseScope): Prisma.TransferOrderWhereInput {
    if (!scope.warehouseIds) return {};
    return { OR: [scopeWhere(scope, 'warehouseId'), scopeWhere(scope, 'toWarehouseId')] };
  }

  /** The TO Out / TO In list's where and order, shared by the list and its export. */
  private listQuery(query: QueryTransferOrderDto, scope: WarehouseScope) {
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);

    const where: Prisma.TransferOrderWhereInput =
      query.direction === 'in'
        ? { ...this.inboundScopeWhere(scope), statusName: { notIn: NOT_INBOUND_STATUSES } }
        : {};
    // AND-ed in, so the search's OR below does not replace it.
    const and: Prisma.TransferOrderWhereInput[] = query.direction === 'in' ? [] : [this.scopeWhere(scope)];
    if (query.status && query.status !== 'all') {
      where.statusName = query.status;
    }
    if (query.search) {
      where.OR = [
        { tranId: { contains: query.search, mode: 'insensitive' } },
        { toLocationName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    for (const f of query.filters ?? []) {
      const build = TO_FILTERS[f.field];
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (build && values.length) and.push({ OR: values.map(build) });
    }
    if (and.length) where.AND = and;
    return { where, orderBy };
  }

  /**
   * The TO export (WMS dev's "ITI TO" sheet), the same for TO Out and TO In:
   * every order the list's filters match — not only one page — in the list's
   * order (a Part Number filter keeps only the matching lines). One row per
   * line and shipped delivery line (SD, packing, from and
   * staging bin); a line WMS has not shipped is one row with those left
   * empty, carrying Oracle's fulfilled / received qty if it has any. GRs are
   * tied to the TO line, not to an SD, so a line's received qty is spread
   * over its SDs in shipping order. Yielded in batches.
   */
  async *exportRows(query: QueryTransferOrderDto, scope: WarehouseScope): AsyncGenerator<TransferOrderExportRow[]> {
    const { where, orderBy } = this.listQuery(query, scope);
    // A Part Number filter keeps only the matching lines, as the list's
    // accordion does (item name or material code, values OR-ed).
    const partFilters = (query.filters ?? [])
      .filter((f) => f.field === 'material_code')
      .map((f) => (f.values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean))
      .filter((values) => values.length);
    const lineMatches = (itemName: string | null, code: string | null | undefined) =>
      partFilters.every((values) =>
        values.some((v) => (itemName ?? '').toLowerCase().includes(v) || (code ?? '').toLowerCase().includes(v)),
      );
    const BATCH = 200;
    for (let skip = 0; ; skip += BATCH) {
      const orders = await this.prisma.transferOrder.findMany({
        where,
        // The id keeps paging stable when the sort column has ties.
        orderBy: [orderBy, { id: 'asc' }],
        skip,
        take: BATCH,
        include: {
          warehouse: { select: { name: true } },
          items: {
            orderBy: { lineNumber: 'asc' },
            include: {
              deliveryItems: {
                where: { delivery: { status: 'Closed' } },
                orderBy: [{ delivery: { updatedAt: 'asc' } }, { createdAt: 'asc' }],
                select: {
                  qty: true,
                  bin: { select: { binLabel: true } },
                  pickingItem: { select: { bin: { select: { binLabel: true } } } },
                  packing: { select: { packingCode: true } },
                  delivery: { select: { sdoId: true, deliveryCode: true, updatedAt: true } },
                },
              },
            },
          },
        },
      });
      const lines = orders.flatMap((o) => o.items);
      const [matById, receivedAt, destinations] = await Promise.all([
        this.materialsById(lines),
        this.lastReceivedAt(lines.map((l) => l.id)),
        this.warehouseNames(orders.map((o) => o.toWarehouseId)),
      ]);

      const rows: TransferOrderExportRow[] = [];
      for (const o of orders) {
        const head = {
          tran_id: o.tranId,
          status: o.statusName,
          erp_doc_id: o.oracleId,
          origin: o.warehouse?.name ?? o.fromLocationName,
          destination: (o.toWarehouseId && destinations.get(o.toWarehouseId)) || o.toLocationName,
          created_at: o.createdAt,
        };
        for (const l of o.items) {
          const mat = l.materialId ? matById.get(l.materialId) : null;
          if (!lineMatches(l.itemName, mat?.materialCode)) continue;
          const line = {
            ...head,
            request_qty: l.quantity,
            material_code: mat?.materialCode ?? l.itemName,
            material_name: mat?.materialName ?? l.description,
            erp_line_id: l.lineNumber,
            uom: mat?.primaryUom?.uomCode ?? null,
          };
          if (!l.deliveryItems.length) {
            // Nothing shipped through WMS: Oracle's own figures, if any (a TO
            // fulfilled or received in Oracle directly).
            rows.push({
              ...line,
              sd_number: null,
              packing_id: null,
              from_bin: null,
              staging_bin: null,
              qty_shipped: l.fulfilled > 0 ? l.fulfilled : null,
              qty_received: l.received > 0 ? l.received : null,
              date_shipped: null,
              date_received: l.received > 0 ? (receivedAt.get(l.id) ?? null) : null,
            });
            continue;
          }
          let toReceive = l.received;
          for (const d of l.deliveryItems) {
            const received = Math.min(d.qty, Math.max(0, toReceive));
            toReceive -= received;
            rows.push({
              ...line,
              sd_number: d.delivery.sdoId ?? d.delivery.deliveryCode,
              packing_id: d.packing?.packingCode ?? null,
              from_bin: d.pickingItem?.bin?.binLabel ?? null,
              staging_bin: d.bin?.binLabel ?? null,
              qty_shipped: d.qty,
              qty_received: received > 0 ? received : null,
              date_shipped: d.delivery.updatedAt,
              date_received: received > 0 ? (receivedAt.get(l.id) ?? null) : null,
            });
          }
        }
      }
      if (rows.length) yield rows;
      if (orders.length < BATCH) return;
    }
  }

  /** Per TO line, when its latest Goods Receive was closed (received). */
  private async lastReceivedAt(lineIds: string[]) {
    const items = lineIds.length
      ? await this.prisma.goodsReceiveItem.findMany({
          where: { transferOrderItemId: { in: lineIds }, goodsReceive: { status: 'Closed' } },
          select: { transferOrderItemId: true, goodsReceive: { select: { updatedAt: true } } },
        })
      : [];
    const at = new Map<string, Date>();
    for (const it of items) {
      const id = it.transferOrderItemId;
      if (!id) continue;
      const prev = at.get(id);
      if (!prev || it.goodsReceive.updatedAt > prev) at.set(id, it.goodsReceive.updatedAt);
    }
    return at;
  }

  /** WMS warehouse names by id (a TO stores its destination as a bare id). */
  private async warehouseNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = unique.length
      ? await this.prisma.warehouse.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
      : [];
    return new Map(rows.map((w) => [w.id, w.name]));
  }

  async findAll(query: QueryTransferOrderDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const { where, orderBy } = this.listQuery(query, scope);

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
    const inboundQty =
      query.direction === 'in'
        ? await this.inboundQtyByLine(withLines.flatMap((r) => r.items.map((l) => l.id)))
        : null;
    const totals = await this.lineTotals(where);

    return {
      ...paginationMeta(total, page, limit, query),
      totals,
      rows: rows.map((r) => ({
        id: r.id,
        oracle_id: r.oracleId,
        outbound_id: r.outboundId,
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
              items: (r.items as ToLine[]).map((l) => ({
                ...this.serializeLine(l, matById, available, r.warehouseId),
                ...(inboundQty
                  ? this.inboundLine(l, l.materialId ? matById.get(l.materialId) : null, inboundQty)
                  : {}),
              })),
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
            materialType: { select: { materialTypeName: true } },
            materialCategory: { select: { materialCategoryName: true } },
          },
        })
      : [];
    return new Map<string, MatInfo>(mats.map((m) => [m.id, m]));
  }

  /**
   * Per TO line, the planned qty on GRs not received yet (Open / Sync Failed).
   * Received qty itself is the line's `received` — Oracle's figure, which a
   * WMS receive also raises.
   */
  private async inboundQtyByLine(lineIds: string[]) {
    const rows = lineIds.length
      ? await this.prisma.goodsReceiveItem.findMany({
          where: { transferOrderItemId: { in: lineIds } },
          select: {
            transferOrderItemId: true,
            qty: true,
            qtyActual: true,
            goodsReceive: { select: { status: true } },
          },
        })
      : [];
    const openPlanned = new Map<string, number>();
    for (const r of rows) {
      const id = r.transferOrderItemId;
      if (!id) continue;
      const open = r.goodsReceive.status === 'Open' || r.goodsReceive.status === 'SyncFailed';
      if (open) openPlanned.set(id, (openPlanned.get(id) ?? 0) + r.qty);
    }
    return { openPlanned };
  }

  /** The inbound (TO In) view of one line: shipped, on a GR, received, remain. */
  private inboundLine(
    l: { id: string; fulfilled: number; received: number },
    mat: MatInfo | null | undefined,
    qty: { openPlanned: Map<string, number> },
  ) {
    // On a GR = already received + planned on GRs still to be received.
    const grQty = l.received + (qty.openPlanned.get(l.id) ?? 0);
    return {
      material_type: mat?.materialType?.materialTypeName ?? null,
      material_category: mat?.materialCategory?.materialCategoryName ?? null,
      shipped_qty: l.fulfilled,
      gr_qty: grQty,
      receive_qty: l.received,
      // Still to be put on a GR.
      remain_qty: Math.max(0, l.fulfilled - grQty),
    };
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
    const lines = await this.prisma.transferOrderItem.findMany({
      where: lineWhere,
      select: { quantity: true, committed: true, remainingQty: true, shipped: true },
    });
    const totals = { request_qty: 0, given_qty: 0, remaining_qty: 0, actual_delivery: 0 };
    for (const l of lines) {
      totals.request_qty += l.quantity;
      totals.given_qty += Math.max(0, l.committed - l.remainingQty);
      totals.remaining_qty += l.remainingQty;
      // Shipped as Oracle reports it (re-synced after every shipment).
      totals.actual_delivery += l.shipped;
    }
    return totals;
  }

  // Inbound to Transfer Stock is scoped to the TO's DESTINATION warehouse.
  private inboundScopeWhere(scope: WarehouseScope): Prisma.TransferOrderWhereInput {
    return scopeWhere(scope, 'toWarehouseId');
  }

  /**
   * One TO seen from its destination (Inbound from Transfer Stock): per line
   * what was fulfilled in Oracle, what is already received and what is still
   * outstanding to receive.
   */
  async findOneInbound(id: string, scope: WarehouseScope) {
    const to = await this.prisma.transferOrder.findFirst({
      where: { id, ...this.inboundScopeWhere(scope), statusName: { notIn: NOT_INBOUND_STATUSES } },
      include: {
        warehouse: { select: { id: true, name: true, subsidiaryName: true } },
        items: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (!to) throw new NotFoundException(`Transfer order ${id} not found`);
    const [matById, destination, inboundQty] = await Promise.all([
      this.materialsById(to.items),
      to.toWarehouseId
        ? this.prisma.warehouse.findUnique({ where: { id: to.toWarehouseId }, select: { id: true, name: true } })
        : null,
      this.inboundQtyByLine(to.items.map((l) => l.id)),
    ]);
    return {
      id: to.id,
      oracle_id: to.oracleId,
      outbound_id: to.outboundId,
      tran_id: to.tranId,
      status_name: to.statusName,
      ownership: to.warehouse?.subsidiaryName ?? null,
      origin_warehouse: to.warehouse?.name ?? to.fromLocationName,
      destination_warehouse_id: destination?.id ?? to.toWarehouseId,
      destination_warehouse: destination?.name ?? to.toLocationName,
      memo: to.memo,
      created_by: to.createdBy,
      created_at: to.createdAt,
      last_modified_by: SYNC_ACTOR,
      last_modified: to.lastModified,
      items: to.items.map((l) => {
        const mat = l.materialId ? matById.get(l.materialId) : null;
        return {
          ...this.inboundLine(l, mat, inboundQty),
          id: l.id,
          line_number: l.lineNumber,
          item_name: l.itemName,
          material_id: l.materialId,
          material_code: mat?.materialCode ?? null,
          material_name: mat?.materialName ?? null,
          uom: mat?.primaryUom?.uomCode ?? null,
          quantity: l.quantity,
          fulfilled: l.fulfilled,
          received: l.received,
          // What Oracle will still accept on an item receipt for this line.
          outstanding: Math.max(0, l.fulfilled - l.received),
        };
      }),
    };
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

    return {
      ...this.serializeDetail(to, matById, available),
      // Only the origin warehouse picks; the destination just follows it.
      can_pick: inScope(scope, to.warehouseId),
    };
  }

  private serializeDetail(
    to: ToDetail,
    matById: Map<string, MatInfo>,
    available: Map<string, number>,
  ) {
    return {
      id: to.id,
      oracle_id: to.oracleId,
      outbound_id: to.outboundId,
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
      // Shipped as Oracle reports it (re-synced after every shipment).
      actual_delivery: l.shipped,
    };
  }
}
