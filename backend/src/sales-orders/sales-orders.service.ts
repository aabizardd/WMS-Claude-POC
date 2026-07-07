import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type SalesOrderOrder = Prisma.SalesOrderOrderByWithRelationInput;
const SALES_ORDER_SORTABLE: Record<string, (d: SortDir) => SalesOrderOrder> = {
  tran_id: (d) => ({ tranId: d }),
  customer_name: (d) => ({ customerName: d }),
  location: (d) => ({ warehouse: { name: d } }),
  status_name: (d) => ({ statusName: d }),
  delivery_status: (d) => ({ deliveryStatus: d }),
  total_amount: (d) => ({ totalAmount: d }),
  last_modified: (d) => ({ lastModified: d }),
};

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.SalesOrderInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  items: {
    include: { material: { select: { materialCode: true, materialName: true } } },
    orderBy: { lineNumber: 'asc' as const },
  },
} satisfies Prisma.SalesOrderInclude;

type SoList = Prisma.SalesOrderGetPayload<{ include: typeof listInclude }>;
type SoDetail = Prisma.SalesOrderGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class SalesOrdersService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.SalesOrderWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      SALES_ORDER_SORTABLE,
      { lastModified: 'desc' },
    );

    const where: Prisma.SalesOrderWhereInput = { ...this.scopeWhere(scope) };
    // Status filtering is done here in WMS (on stored data), not sent to Oracle.
    if (query.status) {
      where.statusName = query.status;
    }
    if (query.search) {
      where.OR = [
        { tranId: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { oracleId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where,
        include: listInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) => this.serializeList(r)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !so ||
      (scope.role !== 'admin' && so.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Sales Order ${id} not found`);
    }
    return this.serializeDetail(so);
  }

  // Distinct statuses present in stored data — populates the FE status filter.
  async getStatuses(scope: WarehouseScope) {
    const rows = await this.prisma.salesOrder.findMany({
      where: { ...this.scopeWhere(scope), statusName: { not: null } },
      distinct: ['statusName'],
      select: { statusName: true },
      orderBy: { statusName: 'asc' },
    });
    return { statuses: rows.map((r) => r.statusName).filter((s): s is string => !!s) };
  }

  async getLastSyncAt() {
    const latest = await this.prisma.salesOrder.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serializeList(s: SoList) {
    return {
      id: s.id,
      oracle_id: s.oracleId,
      tran_id: s.tranId,
      tran_date: s.tranDate,
      status_name: s.statusName,
      delivery_status: s.deliveryStatus,
      customer_name: s.customerName,
      location_name: s.locationName,
      warehouse: s.warehouse,
      total_amount: s.totalAmount,
      item_count: s._count.items,
      last_modified: s.lastModified,
      created_at: s.createdAt,
    };
  }

  private serializeDetail(s: SoDetail) {
    return {
      id: s.id,
      oracle_id: s.oracleId,
      tran_id: s.tranId,
      tran_date: s.tranDate,
      status_code: s.statusCode,
      status_name: s.statusName,
      delivery_status: s.deliveryStatus,
      customer_id: s.customerId,
      customer_name: s.customerName,
      memo: s.memo,
      location_name: s.locationName,
      warehouse: s.warehouse,
      subsidiary_name: s.subsidiaryName,
      currency_name: s.currencyName,
      total_amount: s.totalAmount,
      last_modified: s.lastModified,
      date_created: s.dateCreated,
      created_at: s.createdAt,
      items: s.items.map((it) => ({
        id: it.id,
        line_number: it.lineNumber,
        item_oracle_id: it.itemOracleId,
        item_name: it.itemName,
        material_code: it.material?.materialCode ?? null,
        material_name: it.material?.materialName ?? null,
        quantity: it.quantity,
        remaining_qty: it.remainingQty,
        rate: it.rate,
        amount: it.amount,
        shipped: it.shipped,
        description: it.description,
        location_id: it.locationId,
      })),
    };
  }
}
