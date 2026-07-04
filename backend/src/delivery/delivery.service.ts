import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GenerateDeliveryDto } from './dto/generate-delivery.dto';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const packingSelect = {
  id: true,
  packingCode: true,
  picking: {
    select: {
      id: true,
      pickingCode: true,
      status: true,
      salesOrder: { select: { id: true, tranId: true, customerName: true } },
    },
  },
} satisfies Prisma.PackingSelect;

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  packing: { select: packingSelect },
  _count: { select: { items: true } },
} satisfies Prisma.DeliveryInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  packing: { select: packingSelect },
  items: {
    include: {
      material: { select: { materialCode: true, materialName: true } },
      bin: { select: { id: true, binLabel: true } },
      picker: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.DeliveryInclude;

type DeliveryList = Prisma.DeliveryGetPayload<{ include: typeof listInclude }>;
type DeliveryDetail = Prisma.DeliveryGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

  private scopeWhere(scope: WarehouseScope): Prisma.DeliveryWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  async findAll(
    query: { page?: number; limit?: number; search?: string; history?: string | boolean },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;

    // History tab = Closed (shipped) deliveries; Delivery List = active (Open).
    const isHistory = query.history === true || query.history === 'true';
    const where: Prisma.DeliveryWhereInput = {
      ...this.scopeWhere(scope),
      status: isHistory ? 'Closed' : { not: 'Closed' },
    };
    if (query.search) {
      where.OR = [
        { deliveryCode: { contains: query.search, mode: 'insensitive' } },
        { sdoId: { contains: query.search, mode: 'insensitive' } },
        { packing: { packingCode: { contains: query.search, mode: 'insensitive' } } },
        {
          packing: {
            picking: {
              salesOrder: { tranId: { contains: query.search, mode: 'insensitive' } },
            },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
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
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!d || (scope.role !== 'admin' && d.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    return this.serializeDetail(d);
  }

  // ---------- generate ----------

  async generate(dto: GenerateDeliveryDto, scope: WarehouseScope) {
    if (!dto.packingIds?.length) {
      throw new BadRequestException('No packing documents selected');
    }

    const packings = await this.prisma.packing.findMany({
      where: { id: { in: dto.packingIds } },
      include: { items: true, delivery: { select: { id: true } } },
    });
    const byId = new Map(packings.map((p) => [p.id, p]));

    for (const id of dto.packingIds) {
      const p = byId.get(id);
      if (!p) throw new BadRequestException(`Packing ${id} not found`);
      if (scope.role !== 'admin' && p.warehouseId !== scope.warehouseId) {
        throw new NotFoundException(`Packing ${id} not found`);
      }
      if (p.delivery) {
        throw new BadRequestException(
          `Packing ${p.packingCode} already has a delivery document`,
        );
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseCount = await this.prisma.delivery.count({
      where: { deliveryCode: { startsWith: `DEL-${today}` } },
    });

    const createdCodes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      let seq = baseCount;
      for (const id of dto.packingIds) {
        const p = byId.get(id)!;
        seq += 1;
        const deliveryCode = `DEL-${today}-${String(seq).padStart(3, '0')}`;
        // Carry the full packing header + detail into the delivery.
        const items = p.items.map((it) => ({
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          qty: it.qty,
          binId: it.binId,
          pickerId: it.pickerId,
        }));
        await tx.delivery.create({
          data: {
            deliveryCode,
            packingId: p.id,
            warehouseId: p.warehouseId,
            status: 'Open',
            items: { create: items },
          },
        });
        createdCodes.push(deliveryCode);
      }
    });

    this.logger.log(
      `Generated ${createdCodes.length} delivery(ies): ${createdCodes.join(', ')}`,
    );
    return { created: createdCodes.length, delivery_codes: createdCodes };
  }

  // ---------- generate shipment ----------

  // Generate the SDO ID once and close the delivery (moves it to History).
  // On close, the reserved qty of each item's (material, bin) is released from
  // Inventory — only reserved changes.
  async generateShipment(id: string, scope: WarehouseScope) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!d || (scope.role !== 'admin' && d.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    if (d.status === 'Closed' || d.sdoId) {
      throw new BadRequestException('Shipment already generated for this delivery');
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.delivery.count({
      where: { sdoId: { startsWith: `SDO-${today}` } },
    });
    const sdoId = `SDO-${today}-${String(count + 1).padStart(3, '0')}`;

    // Atomic: close the delivery AND reduce reserved qty. Roll back if any fails.
    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id },
        data: { sdoId, status: 'Closed' },
      });

      // Reduce Reserved Qty per (material, bin) by the delivery qty. Only reserved
      // changes; avail/on_hand/qty_issue/quality_issue stay put. Material-level
      // reserved is the sum of its bin stocks, so adjusting the bin stock covers
      // both the material and the bin (Inventory Detail).
      for (const it of d.items) {
        if (!it.materialCode || !(it.qty > 0)) continue;
        const inv = await tx.inventoryManagement.findFirst({
          where: { materialCode: it.materialCode, warehouseId: d.warehouseId },
          select: { id: true },
        });
        if (!inv) continue;
        await this.inventory.adjustBinStock(
          inv.id,
          it.binId,
          { reserved: -it.qty },
          tx,
        );
      }
    });

    this.logger.log(`Shipment generated for delivery ${d.deliveryCode}: ${sdoId}`);
    return this.findOne(id, scope);
  }

  // ---------- serializers ----------

  private serializeList(d: DeliveryList) {
    const so = d.packing?.picking?.salesOrder;
    return {
      id: d.id,
      delivery_id: d.deliveryCode,
      sdo_id: d.sdoId,
      packing_id: d.packing?.packingCode ?? null,
      so_number: so?.tranId ?? null,
      customer: so?.customerName ?? null,
      location: d.warehouse?.name ?? null,
      status: d.status,
      item_count: d._count.items,
      created_at: d.createdAt,
    };
  }

  private serializeDetail(d: DeliveryDetail) {
    const packing = d.packing;
    const picking = packing?.picking;
    const so = picking?.salesOrder;
    return {
      id: d.id,
      delivery_id: d.deliveryCode,
      sdo_id: d.sdoId,
      packing_id: packing?.packingCode ?? null,
      so_id: so?.id ?? null,
      so_number: so?.tranId ?? null,
      customer: so?.customerName ?? null,
      location: d.warehouse?.name ?? null,
      status: d.status,
      created_at: d.createdAt,
      // Full outbound tracking chain: Sales Order → Picking → Packing → Delivery.
      tracking: {
        so_id: so?.id ?? null,
        so_number: so?.tranId ?? null,
        customer: so?.customerName ?? null,
        picking_id: picking?.id ?? null,
        picking_code: picking?.pickingCode ?? null,
        picking_status: picking?.status ?? null,
        packing_id: packing?.id ?? null,
        packing_code: packing?.packingCode ?? null,
        delivery_code: d.deliveryCode,
        sdo_id: d.sdoId,
        delivery_status: d.status,
      },
      items: d.items.map((it) => ({
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
