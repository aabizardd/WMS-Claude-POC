import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { GeneratePackingDto } from './dto/generate-packing.dto';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  picking: {
    select: {
      pickingCode: true,
      salesOrder: { select: { id: true, tranId: true, customerName: true } },
    },
  },
  _count: { select: { items: true } },
} satisfies Prisma.PackingInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  picking: {
    select: {
      pickingCode: true,
      salesOrder: { select: { id: true, tranId: true, customerName: true } },
    },
  },
  items: {
    include: {
      material: { select: { materialCode: true, materialName: true } },
      bin: { select: { id: true, binLabel: true } },
      picker: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.PackingInclude;

type PackingList = Prisma.PackingGetPayload<{ include: typeof listInclude }>;
type PackingDetail = Prisma.PackingGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class PackingService {
  private readonly logger = new Logger(PackingService.name);

  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.PackingWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  // ---------- read ----------

  async findAll(
    query: { page?: number; limit?: number; search?: string },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;

    // Packings that already have a Delivery document are hidden (they move to
    // the Delivery List tab).
    const where: Prisma.PackingWhereInput = {
      ...this.scopeWhere(scope),
      delivery: { is: null },
    };
    if (query.search) {
      where.OR = [
        { packingCode: { contains: query.search, mode: 'insensitive' } },
        { picking: { pickingCode: { contains: query.search, mode: 'insensitive' } } },
        {
          picking: {
            salesOrder: { tranId: { contains: query.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.packing.count({ where }),
      this.prisma.packing.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: { page, limit, order_by: 'created_at desc' },
      rows: rows.map((r) => this.serializeList(r)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const pk = await this.prisma.packing.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !pk ||
      (scope.role !== 'admin' && pk.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Packing ${id} not found`);
    }
    return this.serializeDetail(pk);
  }

  // Closed pickings that don't yet have a packing — selectable for Generate Packing.
  async availablePickings(scope: WarehouseScope) {
    const where: Prisma.PickingWhereInput = {
      status: 'Closed',
      packing: { is: null },
    };
    if (scope.role === 'admin') {
      if (scope.warehouseId) where.warehouseId = scope.warehouseId;
    } else {
      where.warehouseId = scope.warehouseId ?? '__no_warehouse__';
    }

    const rows = await this.prisma.picking.findMany({
      where,
      include: {
        warehouse: { select: { name: true } },
        salesOrder: { select: { tranId: true, customerName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((p) => ({
      id: p.id,
      picking_id: p.pickingCode,
      so_number: p.salesOrder?.tranId ?? null,
      customer: p.salesOrder?.customerName ?? null,
      location: p.warehouse?.name ?? null,
      item_count: p._count.items,
      created_at: p.createdAt,
    }));
  }

  // ---------- generate ----------

  async generate(dto: GeneratePackingDto, scope: WarehouseScope) {
    if (!dto.pickingIds?.length) {
      throw new BadRequestException('No picking documents selected');
    }

    const pickings = await this.prisma.picking.findMany({
      where: { id: { in: dto.pickingIds } },
      include: { items: true, packing: { select: { id: true } } },
    });
    const byId = new Map(pickings.map((p) => [p.id, p]));

    for (const id of dto.pickingIds) {
      const p = byId.get(id);
      if (!p) throw new BadRequestException(`Picking ${id} not found`);
      if (scope.role !== 'admin' && p.warehouseId !== scope.warehouseId) {
        throw new NotFoundException(`Picking ${id} not found`);
      }
      if (p.status !== 'Closed') {
        throw new BadRequestException(
          `Only Closed pickings can be packed (${p.pickingCode} is ${p.status})`,
        );
      }
      if (p.packing) {
        throw new BadRequestException(
          `Picking ${p.pickingCode} already has a packing document`,
        );
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseCount = await this.prisma.packing.count({
      where: { packingCode: { startsWith: `PACK-${today}` } },
    });

    const createdCodes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      let seq = baseCount;
      for (const id of dto.pickingIds) {
        const p = byId.get(id)!;
        seq += 1;
        const packingCode = `PACK-${today}-${String(seq).padStart(3, '0')}`;
        // Carry only the actually-picked qty into packing detail.
        const items = p.items
          .filter((it) => it.actualQty > 0)
          .map((it) => ({
            materialId: it.materialId,
            materialCode: it.materialCode,
            materialName: it.materialName,
            qty: it.actualQty,
            binId: it.binId,
            pickerId: it.pickerId,
          }));
        await tx.packing.create({
          data: {
            packingCode,
            pickingId: p.id,
            warehouseId: p.warehouseId,
            status: 'Open',
            items: { create: items },
          },
        });
        createdCodes.push(packingCode);
      }
    });

    this.logger.log(
      `Generated ${createdCodes.length} packing(s): ${createdCodes.join(', ')}`,
    );
    return { created: createdCodes.length, packing_codes: createdCodes };
  }

  // ---------- serializers ----------

  private serializeList(p: PackingList) {
    return {
      id: p.id,
      packing_id: p.packingCode,
      picking_id: p.picking?.pickingCode ?? null,
      so_number: p.picking?.salesOrder?.tranId ?? null,
      customer: p.picking?.salesOrder?.customerName ?? null,
      location: p.warehouse?.name ?? null,
      status: p.status,
      item_count: p._count.items,
      created_at: p.createdAt,
    };
  }

  private serializeDetail(p: PackingDetail) {
    return {
      id: p.id,
      packing_id: p.packingCode,
      picking_id: p.picking?.pickingCode ?? null,
      so_id: p.picking?.salesOrder?.id ?? null,
      so_number: p.picking?.salesOrder?.tranId ?? null,
      customer: p.picking?.salesOrder?.customerName ?? null,
      location: p.warehouse?.name ?? null,
      status: p.status,
      created_at: p.createdAt,
      items: p.items.map((it) => ({
        id: it.id,
        material_code: it.materialCode ?? it.material?.materialCode ?? null,
        material_name: it.materialName ?? it.material?.materialName ?? null,
        qty: it.qty,
        bin_label: it.bin?.binLabel ?? null,
        picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
      })),
    };
  }
}
