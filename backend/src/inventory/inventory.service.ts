import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const materialInclude = {
  material: {
    include: {
      materialType: { select: { materialTypeName: true } },
      materialCategory: { select: { materialCategoryName: true } },
      primaryUom: { select: { uomCode: true, uomName: true } },
    },
  },
  warehouse: { select: { id: true, name: true } },
} satisfies Prisma.InventoryManagementInclude;

const detailInclude = {
  ...materialInclude,
  batches: {
    include: {
      bin: { select: { binLabel: true } },
      goodsReceive: { select: { grNumber: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.InventoryManagementInclude;

type InvList = Prisma.InventoryManagementGetPayload<{
  include: typeof materialInclude;
}> & {
  batches?: { reservedQty: number; availQty: number; inTransitQty: number; qualityIssue: number; qtyIssue: number }[];
};

type InvDetail = Prisma.InventoryManagementGetPayload<{
  include: typeof detailInclude;
}>;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.InventoryManagementWhereInput {
    if (scope.role === 'admin') return {};
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  // ---------- read ----------

  async findAll(
    query: { page?: number; limit?: number; search?: string },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.InventoryManagementWhereInput = {
      ...this.scopeWhere(scope),
    };
    if (query.search) {
      where.OR = [
        { materialCode: { contains: query.search, mode: 'insensitive' } },
        {
          material: {
            materialName: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryManagement.count({ where }),
      this.prisma.inventoryManagement.findMany({
        where,
        include: {
          ...materialInclude,
          batches: {
            select: {
              reservedQty: true,
              availQty: true,
              inTransitQty: true,
              qualityIssue: true,
              qtyIssue: true,
            },
          },
        },
        orderBy: { materialCode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: { page, limit, order_by: 'material_code asc' },
      rows: rows.map((r) => this.serializeList(r as InvList)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const inv = await this.prisma.inventoryManagement.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !inv ||
      (scope.role !== 'admin' && inv.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Inventory ${id} not found`);
    }
    return this.serializeDetail(inv);
  }

  // ---------- generation (called when a GR is received) ----------

  async generateFromGoodsReceive(goodsReceiveId: string) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
      include: { mrn: { include: { items: true } } },
    });
    if (!gr) return;

    let created = 0;
    for (const item of gr.mrn.items) {
      if (!(item.qtyActual > 0)) continue;

      // Idempotent: one batch per received MRN item.
      const existing = await this.prisma.inventoryBatch.findUnique({
        where: { mrnItemId: item.id },
      });
      if (existing) continue;

      // Material: join mrn_item.item_id -> materials.erp_doc_id
      const material =
        item.itemId != null
          ? await this.prisma.material.findUnique({
              where: { erpDocId: String(item.itemId) },
            })
          : null;
      const materialCode =
        material?.materialCode ?? item.itemName ?? `ITEM-${item.itemId}`;

      // Find-or-create the inventory row for (materialCode, warehouse).
      let inv = await this.prisma.inventoryManagement.findFirst({
        where: { materialCode, warehouseId: gr.warehouseId },
      });
      if (!inv) {
        inv = await this.prisma.inventoryManagement.create({
          data: {
            materialCode,
            materialId: material?.id ?? null,
            warehouseId: gr.warehouseId,
          },
        });
      } else if (!inv.materialId && material) {
        inv = await this.prisma.inventoryManagement.update({
          where: { id: inv.id },
          data: { materialId: material.id },
        });
      }

      // company_name from the vendor master (oracleId = mrn_item.vendor_id).
      let vendorCompanyName = item.vendorName ?? null;
      if (item.vendorId != null) {
        const vendor = await this.prisma.vendor.findUnique({
          where: { oracleId: String(item.vendorId) },
        });
        if (vendor?.companyName) vendorCompanyName = vendor.companyName;
      }

      const batch = await this.prisma.inventoryBatch.create({
        data: {
          inventoryId: inv.id,
          availQty: item.qtyActual, // received qty becomes available
          binId: item.binId ?? null,
          goodsReceiveId: gr.id,
          mrnItemId: item.id,
          vendorCompanyName,
        },
      });

      if (item.qtyActual < item.qtyExpected) {
        const gap = item.qtyExpected - item.qtyActual;
        await this.prisma.inventoryBatch.update({
          where: { id: batch.id },
          data: { qtyIssue: gap },
        });
      }
      created++;
    }
    this.logger.log(
      `Inventory generated for GR ${goodsReceiveId}: ${created} batch(es)`,
    );
    return { created };
  }

  // ---------- serializers ----------

  private sumBatches(
    batches: {
      reservedQty: number;
      availQty: number;
      inTransitQty: number;
      qualityIssue: number;
      qtyIssue: number;
    }[],
  ) {
    const s = batches.reduce(
      (a, b) => ({
        reserved_qty: a.reserved_qty + b.reservedQty,
        avail_qty: a.avail_qty + b.availQty,
        in_transit_qty: a.in_transit_qty + b.inTransitQty,
        quality_issue: a.quality_issue + b.qualityIssue,
        qty_issue: a.qty_issue + b.qtyIssue,
      }),
      {
        reserved_qty: 0,
        avail_qty: 0,
        in_transit_qty: 0,
        quality_issue: 0,
        qty_issue: 0,
      },
    );
    return {
      ...s,
      // on_hand = reserved + avail + quality_issue + qty_issue
      on_hand: s.reserved_qty + s.avail_qty + s.quality_issue + s.qty_issue,
    };
  }

  private materialFields(m: InvList | InvDetail) {
    return {
      material_name: m.material?.materialName ?? null,
      material_code: m.materialCode,
      material_type: m.material?.materialType?.materialTypeName ?? null,
      material_category:
        m.material?.materialCategory?.materialCategoryName ?? null,
      primary_uom: m.material?.primaryUom?.uomCode ?? null,
      warehouse_name: m.warehouse?.name ?? null,
    };
  }

  private serializeList(m: InvList) {
    return {
      id: m.id,
      ...this.materialFields(m),
      ...this.sumBatches(m.batches ?? []),
    };
  }

  private serializeDetail(m: InvDetail) {
    return {
      id: m.id,
      ...this.materialFields(m),
      ...this.sumBatches(m.batches),
      batches: m.batches.map((b) => ({
        id: b.id,
        reserved_qty: b.reservedQty,
        avail_qty: b.availQty,
        in_transit_qty: b.inTransitQty,
        quality_issue: b.qualityIssue,
        qty_issue: b.qtyIssue,
        on_hand:
          b.reservedQty + b.availQty + b.qualityIssue + b.qtyIssue,
        warehouse_name: m.warehouse?.name ?? null,
        bin_location: b.bin?.binLabel ?? null,
        gr_number: b.goodsReceive?.grNumber ?? null,
        company_name: b.vendorCompanyName ?? null,
        created_at: b.createdAt,
      })),
    };
  }
}
