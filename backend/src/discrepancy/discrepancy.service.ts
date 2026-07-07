import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type DiscrepancyOrder = Prisma.DiscrepancyOrderByWithRelationInput;
const DISCREPANCY_SORTABLE: Record<string, (d: SortDir) => DiscrepancyOrder> = {
  discrepancy_id: (d) => ({ discrepancyId: d }),
  type: (d) => ({ discrepancyType: d }),
  from: (d) => ({ discrepancyFrom: d }),
  reported_by: (d) => ({ reportedBy: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
};

const listInclude = {
  goodsReceive: { select: { grNumber: true } },
  picking: { select: { pickingCode: true } },
  reportedBy: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  _count: { select: { details: true } },
} satisfies Prisma.DiscrepancyInclude;

const detailInclude = {
  goodsReceive: { select: { grNumber: true } },
  picking: { select: { pickingCode: true } },
  reportedBy: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  details: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DiscrepancyInclude;

// Header "Source Number" + "Source" label, derived from the linked document.
function sourceOf(d: {
  goodsReceive?: { grNumber: string } | null;
  picking?: { pickingCode: string } | null;
}) {
  if (d.goodsReceive) {
    return { source_number: d.goodsReceive.grNumber, source: 'Inbound - Goods Receive' };
  }
  if (d.picking) {
    return { source_number: d.picking.pickingCode, source: 'Outbound - Picking' };
  }
  return { source_number: null as string | null, source: null as string | null };
}

type DiscList = Prisma.DiscrepancyGetPayload<{ include: typeof listInclude }>;
type DiscDetail = Prisma.DiscrepancyGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class DiscrepancyService {
  private readonly logger = new Logger(DiscrepancyService.name);

  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.DiscrepancyWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  // ---------- read ----------

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      type?: string;
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
      DISCREPANCY_SORTABLE,
      { createdAt: 'desc' },
    );

    const where: Prisma.DiscrepancyWhereInput = { ...this.scopeWhere(scope) };
    if (query.type === 'quantity' || query.type === 'quality') {
      where.discrepancyType = query.type;
    }
    if (query.search) {
      where.OR = [
        { discrepancyId: { contains: query.search, mode: 'insensitive' } },
        {
          goodsReceive: {
            grNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          picking: {
            pickingCode: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.discrepancy.count({ where }),
      this.prisma.discrepancy.findMany({
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
        type: query.type ?? null,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) => this.serializeList(r)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const disc = await this.prisma.discrepancy.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !disc ||
      (scope.role !== 'admin' && disc.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Discrepancy ${id} not found`);
    }
    return this.serializeDetail(disc);
  }

  // ---------- generation (called when a GR is received) ----------

  // Record a quantity discrepancy for items received short (actual < expected).
  async recordFromGoodsReceive(goodsReceiveId: string, reportedById?: number) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
      include: { mrn: { include: { items: true } } },
    });
    if (!gr) return;

    const shortItems = gr.mrn.items.filter(
      (it) => it.qtyActual < it.qtyExpected,
    );
    if (shortItems.length === 0) return;

    // Idempotent: one quantity discrepancy per GR.
    const existing = await this.prisma.discrepancy.findFirst({
      where: { grId: gr.id, discrepancyType: 'quantity' },
    });
    if (existing) return;

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.discrepancy.count({
      where: { discrepancyId: { startsWith: `DISC-${today}` } },
    });
    const seq = String(count + 1).padStart(3, '0');
    const discId = `DISC-${today}-${seq}`;

    await this.prisma.discrepancy.create({
      data: {
        discrepancyId: discId,
        grId: gr.id,
        reportedById: reportedById ?? null,
        discrepancyType: 'quantity',
        discrepancyFrom: 'inbound',
        warehouseId: gr.warehouseId,
        details: {
          create: shortItems.map((it) => {
            const gap = Math.max(
              0,
              Math.round(it.qtyExpected - it.qtyActual),
            );
            return {
              poNumber: it.poNumber ?? '',
              itemName: it.itemName,
              mrnItemId: it.id,
              sourceFrom: 'GR' as const,
              qtyDiscrepancy: gap,
              qtyDiscrepancyType: 'shortage' as const,
            };
          }),
        },
      },
    });
    this.logger.log(
      `Quantity discrepancy recorded for GR ${gr.grNumber}: ${shortItems.length} item(s)`,
    );
  }

  // ---------- serializers ----------

  private serializeList(d: DiscList) {
    return {
      id: d.id,
      discrepancy_id: d.discrepancyId,
      ...sourceOf(d),
      discrepancy_type: d.discrepancyType,
      discrepancy_from: d.discrepancyFrom,
      reported_by: d.reportedBy?.name ?? null,
      warehouse_name: d.warehouse?.name ?? null,
      detail_count: d._count.details,
      created_at: d.createdAt,
    };
  }

  private serializeDetail(d: DiscDetail) {
    return {
      id: d.id,
      discrepancy_id: d.discrepancyId,
      ...sourceOf(d),
      discrepancy_type: d.discrepancyType,
      discrepancy_from: d.discrepancyFrom,
      reported_by: d.reportedBy?.name ?? null,
      warehouse_name: d.warehouse?.name ?? null,
      created_at: d.createdAt,
      details: d.details.map((x) => ({
        id: x.id,
        po_number: x.poNumber,
        item_name: x.itemName,
        source_from: x.sourceFrom,
        qty_discrepancy: x.qtyDiscrepancy,
        qty_discrepancy_type: x.qtyDiscrepancyType,
      })),
    };
  }
}
