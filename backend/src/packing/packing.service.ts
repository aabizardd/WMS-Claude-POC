import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GeneratePackingDto } from './dto/generate-packing.dto';
import type { ProgressPackingDto } from './dto/progress-packing.dto';

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

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

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
            salesOrderItemId: it.salesOrderItemId, // carry SO line reference
            materialId: it.materialId,
            materialCode: it.materialCode,
            materialName: it.materialName,
            qty: it.actualQty, // base = picking actual qty
            remainingQty: it.actualQty, // nothing packed yet
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

  // ---------- progress / close ----------

  // Record packing progress (accumulated). Closes the packing when every item's
  // remaining reaches 0. On close: settle inventory (issue gap released from
  // reserved into the bin's issue buckets) and auto-create discrepancies.
  async progress(id: string, dto: ProgressPackingDto, scope: WarehouseScope) {
    const pk = await this.prisma.packing.findUnique({
      where: { id },
      include: { items: true },
    });
    if (
      !pk ||
      (scope.role !== 'admin' && pk.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Packing ${id} not found`);
    }
    if (pk.status === 'Closed') {
      throw new BadRequestException('Packing is already closed');
    }

    const itemById = new Map(pk.items.map((it) => [it.id, it]));
    for (const row of dto.items) {
      const it = itemById.get(row.id);
      if (!it) {
        throw new BadRequestException(`Item ${row.id} is not in this packing`);
      }
      const a = Number(row.actualQty) || 0;
      const qi = Number(row.qtyIssue) || 0;
      const ql = Number(row.qualityIssue) || 0;
      if (a < 0 || qi < 0 || ql < 0) {
        throw new BadRequestException('Quantities cannot be negative');
      }
      if (a + qi + ql > it.remainingQty + 1e-9) {
        throw new BadRequestException(
          `Input (${a + qi + ql}) exceeds remaining (${it.remainingQty}) for "${it.materialName ?? it.id}"`,
        );
      }
    }

    const justClosed = await this.prisma.$transaction(async (tx) => {
      for (const row of dto.items) {
        const it = itemById.get(row.id)!;
        const a = it.actualQty + (Number(row.actualQty) || 0);
        const qi = it.qtyIssue + (Number(row.qtyIssue) || 0);
        const ql = it.qualityIssue + (Number(row.qualityIssue) || 0);
        const remaining = Math.max(0, it.qty - a - qi - ql);
        await tx.packingItem.update({
          where: { id: it.id },
          data: {
            actualQty: a,
            qtyIssue: qi,
            qualityIssue: ql,
            remainingQty: remaining,
          },
        });
        it.actualQty = a;
        it.qtyIssue = qi;
        it.qualityIssue = ql;
        it.remainingQty = remaining;
      }

      const all = [...itemById.values()];
      const allClosed = all.every((it) => it.remainingQty <= 1e-9);
      if (!allClosed) return false;

      await tx.packing.update({ where: { id }, data: { status: 'Closed' } });

      // Settle inventory just like Picking close: only the gap that could not be
      // packed (qtyIssue + qualityIssue) is released from reserved into the bin's
      // issue buckets. The packed actualQty stays reserved (released later at
      // Generate Shipment). on_hand is unchanged.
      for (const it of all) {
        if (!it.materialCode) continue;
        const gap = it.qtyIssue + it.qualityIssue;
        if (gap <= 0) continue;
        const inv = await tx.inventoryManagement.findFirst({
          where: { materialCode: it.materialCode, warehouseId: pk.warehouseId },
          select: { id: true },
        });
        if (!inv) continue;
        await this.inventory.adjustBinStock(
          inv.id,
          it.binId,
          { reserved: -gap, qtyIssue: it.qtyIssue, quality: it.qualityIssue },
          tx,
        );
      }
      return true;
    });

    if (justClosed) {
      try {
        await this.recordPackingDiscrepancies(id);
      } catch (e) {
        this.logger.error(
          `Packing discrepancy recording failed for ${id}: ${(e as Error).message}`,
        );
      }
    }

    return this.findOne(id, scope);
  }

  // Auto-create Outbound discrepancies from packing qty/quality issues.
  // Grouped per parent picking + type; detail source_from = 'Packing'.
  private async recordPackingDiscrepancies(packingId: string) {
    const pk = await this.prisma.packing.findUnique({
      where: { id: packingId },
      include: { items: true },
    });
    if (!pk) return;
    const pkItems = pk.items;

    const mkDetails = (amount: (it: (typeof pkItems)[number]) => number) =>
      pkItems
        .filter((it) => amount(it) > 0)
        .map((it) => ({
          poNumber: '',
          itemName: it.materialName,
          sourceFrom: 'Packing' as const,
          qtyDiscrepancy: Math.round(amount(it)),
          qtyDiscrepancyType: 'shortage' as const,
        }));

    const specs = [
      { type: 'quantity' as const, details: mkDetails((it) => it.qtyIssue) },
      { type: 'quality' as const, details: mkDetails((it) => it.qualityIssue) },
    ];

    for (const spec of specs) {
      if (spec.details.length === 0) continue;
      // One discrepancy header per (parent picking, type, Packing source).
      const existing = await this.prisma.discrepancy.findFirst({
        where: {
          pickingId: pk.pickingId,
          discrepancyType: spec.type,
          details: { some: { sourceFrom: 'Packing' } },
        },
      });
      if (existing) continue;

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await this.prisma.discrepancy.count({
        where: { discrepancyId: { startsWith: `DISC-${today}` } },
      });
      const seq = String(count + 1).padStart(3, '0');
      await this.prisma.discrepancy.create({
        data: {
          discrepancyId: `DISC-${today}-${seq}`,
          pickingId: pk.pickingId,
          discrepancyType: spec.type,
          discrepancyFrom: 'outbound',
          warehouseId: pk.warehouseId,
          details: { create: spec.details },
        },
      });
      this.logger.log(
        `Outbound ${spec.type} discrepancy recorded for packing ${pk.packingCode}`,
      );
    }
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
    const totals = p.items.reduce(
      (a, it) => ({
        request: a.request + it.qty,
        actual: a.actual + it.actualQty,
        qty_issue: a.qty_issue + it.qtyIssue,
        quality_issue: a.quality_issue + it.qualityIssue,
        remaining: a.remaining + it.remainingQty,
      }),
      { request: 0, actual: 0, qty_issue: 0, quality_issue: 0, remaining: 0 },
    );
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
      totals,
      items: p.items.map((it) => ({
        id: it.id,
        material_code: it.materialCode ?? it.material?.materialCode ?? null,
        material_name: it.materialName ?? it.material?.materialName ?? null,
        qty: it.qty, // base (target to pack)
        actual_qty: it.actualQty,
        qty_issue: it.qtyIssue,
        quality_issue: it.qualityIssue,
        remaining_qty: it.remainingQty,
        bin_label: it.bin?.binLabel ?? null,
        picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
      })),
    };
  }
}
