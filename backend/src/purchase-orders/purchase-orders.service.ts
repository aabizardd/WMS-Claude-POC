import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { paginationMeta } from '../common/pagination';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type PoOrder = Prisma.PurchaseOrderOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => PoOrder> = {
  po_number: (d) => ({ poNumber: d }),
  po_date: (d) => ({ poDate: d }),
  po_status: (d) => ({ poStatus: d }),
  vendor_name: (d) => ({ vendorName: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: PoOrder = { lastModified: 'desc' };

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  lines: { orderBy: { lineId: 'asc' } },
} satisfies Prisma.PurchaseOrderInclude;

type PoDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;
type PoLine = PoDetail['lines'][number];

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.PurchaseOrderWhereInput {
    // Subsidiary allow-list (same as SalesOrder/Vendor) + warehouse scoping.
    const where: Prisma.PurchaseOrderWhereInput = {
      subsidiaryId: subsidiarySingleFilter(),
    };
    if (scope.role === 'admin') {
      if (scope.warehouseId) where.warehouseId = scope.warehouseId;
    } else {
      where.warehouseId = scope.warehouseId ?? '__no_warehouse__';
    }
    return where;
  }

  async findAll(query: QueryPurchaseOrderDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);

    const where: Prisma.PurchaseOrderWhereInput = { ...this.scopeWhere(scope) };
    // Status filter (FE defaults to "pendingReceipt"; empty/"all" → no filter).
    if (query.status && query.status !== 'all') {
      where.poStatus = query.status;
    }
    if (query.search) {
      where.OR = [
        { poNumber: { contains: query.search, mode: 'insensitive' } },
        { vendorName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: { warehouse: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ...paginationMeta(total, page, limit, query),
      rows: rows.map((r) => ({
        id: r.id,
        oracle_id: r.oracleId,
        po_number: r.poNumber,
        po_date: r.poDate,
        po_status: r.poStatus,
        po_status_label: r.poStatusLabel,
        vendor_name: r.vendorName,
        currency_symbol: r.currencySymbol,
        subsidiary_display: r.subsidiaryDisplay,
        warehouse: r.warehouse,
        line_count: r._count.lines,
        last_modified: r.lastModified,
        created_at: r.createdAt,
      })),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...this.scopeWhere(scope) },
      include: detailInclude,
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return this.serializeDetail(po);
  }

  // Distinct PO statuses present (within scope) for the FE status filter.
  async getStatuses(scope: WarehouseScope) {
    const rows = await this.prisma.purchaseOrder.groupBy({
      by: ['poStatus', 'poStatusLabel'],
      where: this.scopeWhere(scope),
      _count: { _all: true },
    });
    return rows
      .filter((r) => r.poStatus)
      .map((r) => ({
        po_status: r.poStatus,
        po_status_label: r.poStatusLabel ?? r.poStatus,
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Most recent last_modified among synced POs — the incremental sync watermark.
  async getLastSyncAt() {
    const latest = await this.prisma.purchaseOrder.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serializeDetail(po: PoDetail) {
    return {
      id: po.id,
      oracle_id: po.oracleId,
      po_number: po.poNumber,
      po_date: po.poDate,
      po_status: po.poStatus,
      po_status_label: po.poStatusLabel,
      memo: po.memo,
      vendor_id: po.vendorId,
      vendor_name: po.vendorName,
      currency_symbol: po.currencySymbol,
      approval_status_display: po.approvalStatusDisplay,
      subsidiary_display: po.subsidiaryDisplay,
      class_display: po.classDisplay,
      department_display: po.departmentDisplay,
      location_name: po.locationName,
      warehouse: po.warehouse,
      created_by_netsuite: po.createdByNetsuite,
      date_created: po.dateCreated,
      last_modified: po.lastModified,
      created_at: po.createdAt,
      lines: po.lines.map((l) => this.serializeLine(l)),
    };
  }

  private serializeLine(l: PoLine) {
    return {
      id: l.id,
      line_id: l.lineId,
      item_oracle_id: l.itemOracleId,
      item_display: l.itemDisplay,
      item_type: l.itemType,
      description: l.description,
      quantity: l.quantity,
      committed: l.committed,
      backordered: l.backordered,
      quantity_received: l.quantityReceived,
      quantity_billed: l.quantityBilled,
      // Remaining still expected to be received.
      qty_remaining_to_receive: Math.max(0, l.quantity - l.quantityReceived),
      location_name: l.locationName,
      department_display: l.departmentDisplay,
      class_display: l.classDisplay,
      inbound_shipment_number: l.inboundShipmentNumber,
      material_id: l.materialId,
    };
  }
}
