import { Injectable, NotFoundException } from '@nestjs/common';
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
  from_location: (d) => ({ fromLocationName: d }),
  to_location: (d) => ({ toLocationName: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: ToOrder = { lastModified: 'desc' };

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  items: { orderBy: { lineNumber: 'asc' } },
} satisfies Prisma.TransferOrderInclude;

type ToDetail = Prisma.TransferOrderGetPayload<{ include: typeof detailInclude }>;
type ToLine = ToDetail['items'][number];

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

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.transferOrder.count({ where }),
      this.prisma.transferOrder.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
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
        tran_id: r.tranId,
        tran_date: r.tranDate,
        status_code: r.statusCode,
        status_name: r.statusName,
        from_location_name: r.fromLocationName,
        to_location_name: r.toLocationName,
        warehouse: r.warehouse,
        item_count: r._count.items,
        last_modified: r.lastModified,
        created_at: r.createdAt,
      })),
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

    // Resolve WMS material names for the lines (item_oracle_id -> erp_doc_id was
    // matched at sync into materialId). TransferOrderItem has no material
    // relation, so batch-fetch names here.
    const materialIds = to.items
      .map((l) => l.materialId)
      .filter((x): x is string => !!x);
    const mats = materialIds.length
      ? await this.prisma.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, materialName: true, materialCode: true },
        })
      : [];
    const matById = new Map(mats.map((m) => [m.id, m]));

    return this.serializeDetail(to, matById);
  }

  private serializeDetail(
    to: ToDetail,
    matById: Map<string, { materialName: string; materialCode: string }>,
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
      warehouse: to.warehouse,
      memo: to.memo,
      date_created: to.dateCreated,
      last_modified: to.lastModified,
      created_at: to.createdAt,
      items: to.items.map((l) => this.serializeLine(l, matById)),
    };
  }

  private serializeLine(
    l: ToLine,
    matById: Map<string, { materialName: string; materialCode: string }>,
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
    };
  }
}
