import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { loadPibMrn } from '../goods-receive/gr-source.util';

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

// The picking carries the outbound source doc (Sales Order or Transfer Order).
const pickingSelect = {
  pickingCode: true,
  sourceType: true,
  salesOrder: { select: { tranId: true } },
  transferOrder: { select: { tranId: true } },
} satisfies Prisma.PickingSelect;

const listInclude = {
  goodsReceive: { select: { grNumber: true } },
  picking: { select: pickingSelect },
  reportedBy: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  _count: { select: { details: true } },
} satisfies Prisma.DiscrepancyInclude;

const detailInclude = {
  goodsReceive: { select: { grNumber: true } },
  picking: { select: pickingSelect },
  reportedBy: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  details: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DiscrepancyInclude;

type SourceDoc = {
  goodsReceive?: { grNumber: string } | null;
  picking?: {
    pickingCode: string;
    sourceType: string;
    salesOrder?: { tranId: string | null } | null;
    transferOrder?: { tranId: string | null } | null;
  } | null;
};

// Header "Source Number" + "Source" label, derived from the linked document.
// For outbound the source number is the originating SO/TO number (NOT the
// picking code) so the list identifies the order the discrepancy belongs to;
// the picking/packing process is exposed on the detail only (see processOf).
function sourceOf(d: SourceDoc) {
  if (d.goodsReceive) {
    return {
      source_type: 'GR' as string | null,
      source_number: d.goodsReceive.grNumber,
      source: 'Inbound - Goods Receive',
      so_number: null as string | null,
      to_number: null as string | null,
    };
  }
  if (d.picking) {
    const isTransfer = d.picking.sourceType === 'TRANSFER_ORDER';
    const soNumber = d.picking.salesOrder?.tranId ?? null;
    const toNumber = d.picking.transferOrder?.tranId ?? null;
    return {
      source_type: (isTransfer ? 'TO' : 'SO') as string | null,
      source_number: (isTransfer ? toNumber : soNumber) ?? null,
      source: isTransfer ? 'Outbound - Transfer Order' : 'Outbound - Sales Order',
      so_number: soNumber,
      to_number: toNumber,
    };
  }
  return {
    source_type: null as string | null,
    source_number: null as string | null,
    source: null as string | null,
    so_number: null as string | null,
    to_number: null as string | null,
  };
}

// Detail-only: which process raised the discrepancy. A header is created by a
// single process, so every detail row shares one sourceFrom ('Picking' |
// 'Packing' | 'GR') — take it from the first row.
function processOf(d: SourceDoc & { details: { sourceFrom: string }[] }) {
  const raw = d.details[0]?.sourceFrom ?? null;
  const label = raw === 'GR' ? 'Goods Receive' : raw;
  return {
    source_process: label,
    picking_code: d.picking?.pickingCode ?? null,
  };
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
      source_type?: string;
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
    // Source document filter. Omitted → all sources.
    if (query.source_type === 'GR') {
      where.goodsReceive = { isNot: null };
    } else if (query.source_type === 'SO' || query.source_type === 'TO') {
      where.picking = {
        is: {
          sourceType: query.source_type === 'TO' ? 'TRANSFER_ORDER' : 'SALES_ORDER',
        },
      };
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
        // The list shows the SO/TO number, so it must be searchable too.
        {
          picking: {
            salesOrder: { tranId: { contains: query.search, mode: 'insensitive' } },
          },
        },
        {
          picking: {
            transferOrder: { tranId: { contains: query.search, mode: 'insensitive' } },
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
        source_type: query.source_type ?? null,
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
    });
    if (!gr) return;

    const mrn = await loadPibMrn(this.prisma, gr);
    if (!mrn) return;

    const shortItems = mrn.items.filter(
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
      // Detail-only: the process (Picking/Packing) the discrepancy came from.
      ...processOf(d),
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
