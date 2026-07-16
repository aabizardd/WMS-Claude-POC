import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GeneratePickingDto } from './dto/generate-picking.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type PickingOrder = Prisma.PickingOrderByWithRelationInput;
const PICKING_SORTABLE: Record<string, (d: SortDir) => PickingOrder> = {
  picking_code: (d) => ({ pickingCode: d }),
  so_number: (d) => ({ salesOrder: { tranId: d } }),
  location: (d) => ({ warehouse: { name: d } }),
  customer: (d) => ({ salesOrder: { customerName: d } }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
};

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const listInclude = {
  salesOrder: { select: { id: true, tranId: true, customerName: true } },
  transferOrder: { select: { id: true, tranId: true, toLocationName: true } },
  warehouse: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PickingInclude;

const detailInclude = {
  salesOrder: { select: { id: true, tranId: true, customerName: true } },
  transferOrder: { select: { id: true, tranId: true, toLocationName: true } },
  warehouse: { select: { id: true, name: true } },
  items: {
    include: {
      material: { select: { materialCode: true, materialName: true } },
      bin: { select: { id: true, binLabel: true } },
      picker: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.PickingInclude;

type PickingList = Prisma.PickingGetPayload<{ include: typeof listInclude }>;
type PickingDetail = Prisma.PickingGetPayload<{ include: typeof detailInclude }>;

// SO statuses that still allow generating a picking (remaining = qty - shipped).
const PICKABLE_STATUSES = [
  'Pending Fulfillment',
  'Pending Billing/Partially Fulfilled',
];

// TO statuses that allow generating a picking (remaining = committed-based).
const TO_PICKABLE_STATUSES = [
  'Pending Fulfillment',
  'Pending Receipt/Partially Fulfilled',
  'Partially Fulfilled',
];

@Injectable()
export class PickingService {
  private readonly logger = new Logger(PickingService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

  private scopeWhere(scope: WarehouseScope): Prisma.PickingWhereInput {
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
      source?: string;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, PICKING_SORTABLE, {
      createdAt: 'desc',
    });

    // Pickings that already belong to a Packing are hidden from the list (they
    // move to the Packing List tab). packingId is the membership field — a
    // merged picking has packingId set even when it is not the primary.
    const where: Prisma.PickingWhereInput = {
      ...this.scopeWhere(scope),
      packingId: null,
    };
    // Source filter: SALES_ORDER (SO outbound tab) vs TRANSFER_ORDER (transfer
    // stock tab). Omitted → both.
    if (query.source === 'SALES_ORDER' || query.source === 'TRANSFER_ORDER') {
      where.sourceType = query.source;
    }
    if (query.search) {
      where.OR = [
        { pickingCode: { contains: query.search, mode: 'insensitive' } },
        { salesOrder: { tranId: { contains: query.search, mode: 'insensitive' } } },
        { transferOrder: { tranId: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.picking.count({ where }),
      this.prisma.picking.findMany({
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
    const pk = await this.prisma.picking.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !pk ||
      (scope.role !== 'admin' && pk.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Picking ${id} not found`);
    }
    const availByMatBin = await this.binAvailability(
      pk.warehouseId,
      pk.items.map((it) => it.materialCode).filter((c): c is string => !!c),
    );
    return this.serializeDetail(pk, availByMatBin);
  }

  // Sales Order + items with remaining qty + candidate source bins per material.
  async getPickable(salesOrderId: string, scope: WarehouseScope) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: {
        warehouse: { select: { id: true, name: true } },
        items: {
          include: { material: { select: { materialCode: true, materialName: true } } },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });
    if (
      !so ||
      (scope.role !== 'admin' && so.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Sales Order ${salesOrderId} not found`);
    }

    const materialCodes = so.items
      .map((it) => it.material?.materialCode)
      .filter((c): c is string => !!c);
    const binsByMaterial = await this.availableBinsByMaterial(
      so.warehouseId,
      materialCodes,
    );

    return {
      id: so.id,
      tran_id: so.tranId,
      status_name: so.statusName,
      delivery_status: so.deliveryStatus,
      customer_name: so.customerName,
      warehouse: so.warehouse,
      can_generate: PICKABLE_STATUSES.includes(so.statusName ?? ''),
      items: so.items
        .filter((it) => it.remainingQty > 0)
        .map((it) => ({
          id: it.id,
          line_number: it.lineNumber,
          item_name: it.itemName,
          material_code: it.material?.materialCode ?? null,
          material_name: it.material?.materialName ?? null,
          quantity: it.quantity,
          remaining_qty: it.remainingQty,
          available_bins: it.material?.materialCode
            ? binsByMaterial.get(it.material.materialCode) ?? []
            : [],
        })),
    };
  }

  // ---------- generate ----------

  async generate(dto: GeneratePickingDto, scope: WarehouseScope) {
    // Dispatch by source. Transfer Order picking has its own remaining basis.
    if (dto.transferOrderId) {
      return this.generateFromTransfer(dto, scope);
    }
    if (!dto.salesOrderId) {
      throw new BadRequestException(
        'salesOrderId or transferOrderId is required',
      );
    }
    const so = await this.prisma.salesOrder.findUnique({
      where: { id: dto.salesOrderId },
      include: { items: { include: { material: true } } },
    });
    if (
      !so ||
      (scope.role !== 'admin' && so.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Sales Order ${dto.salesOrderId} not found`);
    }
    if (!PICKABLE_STATUSES.includes(so.statusName ?? '')) {
      throw new BadRequestException(
        `Generate Picking is only allowed for status ${PICKABLE_STATUSES.map((s) => `"${s}"`).join(' or ')} (current: ${so.statusName ?? '—'})`,
      );
    }
    if (!dto.items?.length) {
      throw new BadRequestException('No items selected for picking');
    }

    const itemById = new Map(so.items.map((it) => [it.id, it]));
    for (const row of dto.items) {
      const soItem = itemById.get(row.salesOrderItemId ?? '');
      if (!soItem) {
        throw new BadRequestException(
          `Item ${row.salesOrderItemId} is not part of this Sales Order`,
        );
      }
      if (!(row.requestQty > 0)) {
        throw new BadRequestException(
          `Picking qty must be > 0 for "${soItem.itemName ?? row.salesOrderItemId}"`,
        );
      }
      if (row.requestQty > soItem.remainingQty) {
        throw new BadRequestException(
          `Picking qty (${row.requestQty}) exceeds remaining (${soItem.remainingQty}) for "${soItem.itemName ?? row.salesOrderItemId}"`,
        );
      }
      if (!row.binId) {
        throw new BadRequestException(
          `Bin Source is required for "${soItem.itemName ?? row.salesOrderItemId}"`,
        );
      }
      if (row.pickerId == null) {
        throw new BadRequestException(
          `Picker is required for "${soItem.itemName ?? row.salesOrderItemId}"`,
        );
      }
    }

    // A material may be picked from more than one bin (multiple rows per SO
    // item). Guard: the same bin cannot be used twice for one item, and the
    // total across bins must not exceed the item's remaining.
    this.validateItemBinSplit(
      dto.items,
      (row) => row.salesOrderItemId ?? '',
      (row) => {
        const it = itemById.get(row.salesOrderItemId ?? '')!;
        return { remaining: it.remainingQty, label: it.itemName ?? row.salesOrderItemId ?? '' };
      },
    );

    // Resolve inventory + validate available stock in the chosen bin, and build
    // the reservation plan (avail -> reserved) applied inside the transaction.
    const plan: {
      inventoryId: string;
      binId: string;
      qty: number;
    }[] = [];
    for (const row of dto.items) {
      const soItem = itemById.get(row.salesOrderItemId ?? '')!;
      const materialCode = soItem.material?.materialCode ?? null;
      const inv = materialCode
        ? await this.prisma.inventoryManagement.findFirst({
            where: { materialCode, warehouseId: so.warehouseId },
            include: { binStocks: { where: { binId: row.binId } } },
          })
        : null;
      const avail = inv?.binStocks[0]?.availQty ?? 0;
      if (!inv || row.requestQty > avail) {
        throw new BadRequestException(
          `Picking qty (${row.requestQty}) exceeds available stock (${avail}) in the selected bin for "${soItem.itemName ?? row.salesOrderItemId}"`,
        );
      }
      plan.push({ inventoryId: inv.id, binId: row.binId, qty: row.requestQty });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.picking.count({
      where: { pickingCode: { startsWith: `PICK-${today}` } },
    });
    const seq = String(count + 1).padStart(3, '0');
    const pickingCode = `PICK-${today}-${seq}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const picking = await tx.picking.create({
        data: {
          pickingCode,
          salesOrderId: so.id,
          warehouseId: so.warehouseId,
          status: 'Open',
          items: {
            create: dto.items.map((row) => {
              const soItem = itemById.get(row.salesOrderItemId ?? '')!;
              return {
                salesOrderItemId: soItem.id,
                materialId: soItem.materialId,
                materialCode: soItem.material?.materialCode ?? null,
                materialName: soItem.material?.materialName ?? null,
                requestQty: row.requestQty,
                remainingQty: row.requestQty,
                binId: row.binId,
                pickerId: row.pickerId,
                status: 'Open' as const,
              };
            }),
          },
        },
      });

      // Decrement remaining qty per SO item.
      for (const row of dto.items) {
        await tx.salesOrderItem.update({
          where: { id: row.salesOrderItemId! },
          data: { remainingQty: { decrement: row.requestQty } },
        });
      }

      // At least one item generated -> SO delivery status becomes Progress Picking.
      if (so.deliveryStatus === 'Open') {
        await tx.salesOrder.update({
          where: { id: so.id },
          data: { deliveryStatus: 'ProgressPicking' },
        });
      }

      // Reserve the picked qty in the chosen bin (avail -> reserved).
      for (const p of plan) {
        await this.inventory.adjustBinStock(
          p.inventoryId,
          p.binId,
          { avail: -p.qty, reserved: p.qty },
          tx,
        );
      }

      return picking;
    });

    this.logger.log(
      `Picking ${pickingCode} generated from SO ${so.tranId ?? so.id} (${dto.items.length} item(s))`,
    );

    return this.findOne(created.id, scope);
  }

  // ---------- Transfer Order picking ----------

  private async materialsByIds(ids: (string | null)[]) {
    const clean = ids.filter((x): x is string => !!x);
    const empty = new Map<
      string,
      { materialCode: string | null; materialName: string | null }
    >();
    if (clean.length === 0) return empty;
    const mats = await this.prisma.material.findMany({
      where: { id: { in: clean } },
      select: { id: true, materialCode: true, materialName: true },
    });
    return new Map(
      mats.map((m) => [
        m.id,
        { materialCode: m.materialCode, materialName: m.materialName },
      ]),
    );
  }

  // Transfer Order + items with WMS remaining (committed-based) + source bins.
  async getPickableTransfer(transferOrderId: string, scope: WarehouseScope) {
    const to = await this.prisma.transferOrder.findUnique({
      where: { id: transferOrderId },
      include: {
        warehouse: { select: { id: true, name: true } },
        items: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (
      !to ||
      (scope.role !== 'admin' && to.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Transfer Order ${transferOrderId} not found`);
    }
    const mats = await this.materialsByIds(to.items.map((i) => i.materialId));
    const materialCodes = [...mats.values()]
      .map((m) => m.materialCode)
      .filter((c): c is string => !!c);
    const binsByMaterial = await this.availableBinsByMaterial(
      to.warehouseId,
      materialCodes,
    );
    return {
      id: to.id,
      tran_id: to.tranId,
      status_name: to.statusName,
      from_location_name: to.fromLocationName,
      to_location_name: to.toLocationName,
      warehouse: to.warehouse,
      can_generate: TO_PICKABLE_STATUSES.includes(to.statusName ?? ''),
      items: to.items
        .filter((it) => it.remainingQty > 0)
        .map((it) => {
          const mat = it.materialId ? mats.get(it.materialId) : null;
          return {
            id: it.id,
            line_number: it.lineNumber,
            item_name: it.itemName,
            material_code: mat?.materialCode ?? null,
            material_name: mat?.materialName ?? null,
            quantity: it.quantity,
            remaining_qty: it.remainingQty,
            available_bins: mat?.materialCode
              ? binsByMaterial.get(mat.materialCode) ?? []
              : [],
          };
        }),
    };
  }

  async generateFromTransfer(dto: GeneratePickingDto, scope: WarehouseScope) {
    const to = await this.prisma.transferOrder.findUnique({
      where: { id: dto.transferOrderId! },
      include: { items: true },
    });
    if (
      !to ||
      (scope.role !== 'admin' && to.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(
        `Transfer Order ${dto.transferOrderId} not found`,
      );
    }
    if (!TO_PICKABLE_STATUSES.includes(to.statusName ?? '')) {
      throw new BadRequestException(
        `Generate Picking is only allowed for status ${TO_PICKABLE_STATUSES.map((s) => `"${s}"`).join(', ')} (current: ${to.statusName ?? '—'})`,
      );
    }
    if (!dto.items?.length) {
      throw new BadRequestException('No items selected for picking');
    }

    const itemById = new Map(to.items.map((it) => [it.id, it]));
    const mats = await this.materialsByIds(to.items.map((i) => i.materialId));

    for (const row of dto.items) {
      const toItem = row.transferOrderItemId
        ? itemById.get(row.transferOrderItemId)
        : undefined;
      if (!toItem) {
        throw new BadRequestException(
          `Item ${row.transferOrderItemId} is not part of this Transfer Order`,
        );
      }
      if (!(row.requestQty > 0)) {
        throw new BadRequestException(
          `Picking qty must be > 0 for "${toItem.itemName ?? row.transferOrderItemId}"`,
        );
      }
      if (row.requestQty > toItem.remainingQty) {
        throw new BadRequestException(
          `Picking qty (${row.requestQty}) exceeds remaining (${toItem.remainingQty}) for "${toItem.itemName ?? row.transferOrderItemId}"`,
        );
      }
      if (!row.binId) {
        throw new BadRequestException(
          `Bin Source is required for "${toItem.itemName ?? row.transferOrderItemId}"`,
        );
      }
      if (row.pickerId == null) {
        throw new BadRequestException(
          `Picker is required for "${toItem.itemName ?? row.transferOrderItemId}"`,
        );
      }
    }

    // Multi-bin split guard (see generate() for SO): no duplicate bin per item,
    // and total across bins must not exceed the item's remaining.
    this.validateItemBinSplit(
      dto.items,
      (row) => row.transferOrderItemId ?? '',
      (row) => {
        const it = itemById.get(row.transferOrderItemId ?? '')!;
        return { remaining: it.remainingQty, label: it.itemName ?? row.transferOrderItemId ?? '' };
      },
    );

    const plan: { inventoryId: string; binId: string; qty: number }[] = [];
    for (const row of dto.items) {
      const toItem = itemById.get(row.transferOrderItemId!)!;
      const materialCode = toItem.materialId
        ? mats.get(toItem.materialId)?.materialCode ?? null
        : null;
      const inv = materialCode
        ? await this.prisma.inventoryManagement.findFirst({
            where: { materialCode, warehouseId: to.warehouseId },
            include: { binStocks: { where: { binId: row.binId } } },
          })
        : null;
      const avail = inv?.binStocks[0]?.availQty ?? 0;
      if (!inv || row.requestQty > avail) {
        throw new BadRequestException(
          `Picking qty (${row.requestQty}) exceeds available stock (${avail}) in the selected bin for "${toItem.itemName ?? row.transferOrderItemId}"`,
        );
      }
      plan.push({ inventoryId: inv.id, binId: row.binId, qty: row.requestQty });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.picking.count({
      where: { pickingCode: { startsWith: `PICK-${today}` } },
    });
    const pickingCode = `PICK-${today}-${String(count + 1).padStart(3, '0')}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const picking = await tx.picking.create({
        data: {
          pickingCode,
          sourceType: 'TRANSFER_ORDER',
          transferOrderId: to.id,
          warehouseId: to.warehouseId,
          status: 'Open',
          items: {
            create: dto.items.map((row) => {
              const toItem = itemById.get(row.transferOrderItemId!)!;
              const mat = toItem.materialId ? mats.get(toItem.materialId) : null;
              return {
                transferOrderItemId: toItem.id,
                materialId: toItem.materialId,
                materialCode: mat?.materialCode ?? null,
                materialName: mat?.materialName ?? null,
                requestQty: row.requestQty,
                remainingQty: row.requestQty,
                binId: row.binId,
                pickerId: row.pickerId,
                status: 'Open' as const,
              };
            }),
          },
        },
      });

      for (const row of dto.items) {
        await tx.transferOrderItem.update({
          where: { id: row.transferOrderItemId! },
          data: { remainingQty: { decrement: row.requestQty } },
        });
      }

      for (const p of plan) {
        await this.inventory.adjustBinStock(
          p.inventoryId,
          p.binId,
          { avail: -p.qty, reserved: p.qty },
          tx,
        );
      }

      return picking;
    });

    this.logger.log(
      `Picking ${pickingCode} generated from TO ${to.tranId ?? to.id} (${dto.items.length} item(s))`,
    );

    return this.findOne(created.id, scope);
  }

  // Delete a picking document (only while Open). Rolls back SO remaining qty and
  // the reserved stock (reserved -> avail) in each item's bin.
  async remove(id: string, scope: WarehouseScope) {
    const pk = await this.prisma.picking.findUnique({
      where: { id },
      include: { items: true },
    });
    if (
      !pk ||
      (scope.role !== 'admin' && pk.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Picking ${id} not found`);
    }
    if (pk.status !== 'Open') {
      throw new BadRequestException(
        `Only an Open picking can be deleted (current: ${pk.status})`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const it of pk.items) {
        // Return qty to the source item's remaining (SO or TO).
        if (it.salesOrderItemId) {
          await tx.salesOrderItem.update({
            where: { id: it.salesOrderItemId },
            data: { remainingQty: { increment: it.requestQty } },
          });
        } else if (it.transferOrderItemId) {
          await tx.transferOrderItem.update({
            where: { id: it.transferOrderItemId },
            data: { remainingQty: { increment: it.requestQty } },
          });
        }
        // Reverse the reservation (reserved -> avail) in the same bin.
        if (it.materialCode) {
          const inv = await tx.inventoryManagement.findFirst({
            where: { materialCode: it.materialCode, warehouseId: pk.warehouseId },
            select: { id: true },
          });
          if (inv) {
            await this.inventory.adjustBinStock(
              inv.id,
              it.binId,
              { avail: it.requestQty, reserved: -it.requestQty },
              tx,
            );
          }
        }
      }

      await tx.picking.delete({ where: { id } });

      // SO source: if the SO has no more picking documents, revert its delivery
      // status to Open. (TO has no equivalent WMS status.)
      if (pk.salesOrderId) {
        const remaining = await tx.picking.count({
          where: { salesOrderId: pk.salesOrderId },
        });
        if (remaining === 0) {
          await tx.salesOrder.update({
            where: { id: pk.salesOrderId },
            data: { deliveryStatus: 'Open' },
          });
        }
      }
    });

    this.logger.log(`Picking ${pk.pickingCode} deleted and rolled back`);
    return { deleted: true };
  }

  // ---------- progress ----------

  async progress(
    id: string,
    items: { id: string; actualQty: number; qtyIssue: number; qualityIssue: number }[],
    scope: WarehouseScope,
  ) {
    const pk = await this.prisma.picking.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!pk || (scope.role !== 'admin' && pk.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Picking ${id} not found`);
    }
    if (pk.status === 'Closed') {
      throw new BadRequestException('Picking is already Closed');
    }

    const itemById = new Map(pk.items.map((it) => [it.id, it]));
    // Validate each increment against the item's current remaining.
    for (const row of items) {
      const it = itemById.get(row.id);
      if (!it) {
        throw new BadRequestException(`Item ${row.id} is not part of this picking`);
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

    // Reaching here means the picking is not Closed yet (guarded above).
    const justClosed = await this.prisma.$transaction(async (tx) => {
      for (const row of items) {
        const it = itemById.get(row.id)!;
        const a = it.actualQty + (Number(row.actualQty) || 0);
        const qi = it.qtyIssue + (Number(row.qtyIssue) || 0);
        const ql = it.qualityIssue + (Number(row.qualityIssue) || 0);
        const remaining = Math.max(0, it.requestQty - a - qi - ql);
        const processed = a + qi + ql;
        const itemStatus =
          remaining <= 1e-9 ? 'Closed' : processed > 0 ? 'OnProgress' : 'Open';
        await tx.pickingItem.update({
          where: { id: it.id },
          data: {
            actualQty: a,
            qtyIssue: qi,
            qualityIssue: ql,
            remainingQty: remaining,
            status: itemStatus,
          },
        });
        it.actualQty = a;
        it.qtyIssue = qi;
        it.qualityIssue = ql;
        it.remainingQty = remaining;
      }

      const all = [...itemById.values()];
      const allClosed = all.every((it) => it.remainingQty <= 1e-9);
      const anyProcessed = all.some(
        (it) => it.actualQty + it.qtyIssue + it.qualityIssue > 0,
      );
      const headerStatus = allClosed ? 'Closed' : anyProcessed ? 'OnProgress' : 'Open';
      await tx.picking.update({ where: { id }, data: { status: headerStatus } });

      // On close: settle inventory in each item's bin. Only the gap that could
      // NOT be picked (qtyIssue + qualityIssue) is released from reserved — the
      // actually-picked qty stays reserved (allocated for packing/delivery).
      // The gap moves into the bin's issue buckets (reserved -> issue), keeping
      // on_hand unchanged.
      if (allClosed) {
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
      }
      return allClosed;
    });

    // On close: auto-create discrepancies from qty/quality issues.
    if (justClosed) {
      try {
        await this.recordPickingDiscrepancies(id);
      } catch (e) {
        this.logger.error(
          `Picking discrepancy recording failed for ${id}: ${(e as Error).message}`,
        );
      }
    }

    return this.findOne(id, scope);
  }

  // Auto-create Outbound (Picking) discrepancies grouped per picking + type.
  private async recordPickingDiscrepancies(pickingId: string) {
    const pk = await this.prisma.picking.findUnique({
      where: { id: pickingId },
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
          sourceFrom: 'Picking' as const,
          qtyDiscrepancy: Math.round(amount(it)),
          qtyDiscrepancyType: 'shortage' as const,
        }));

    const specs = [
      { type: 'quantity' as const, details: mkDetails((it) => it.qtyIssue) },
      { type: 'quality' as const, details: mkDetails((it) => it.qualityIssue) },
    ];

    for (const spec of specs) {
      if (spec.details.length === 0) continue;
      const existing = await this.prisma.discrepancy.findFirst({
        where: { pickingId, discrepancyType: spec.type },
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
          pickingId,
          discrepancyType: spec.type,
          discrepancyFrom: 'outbound',
          warehouseId: pk.warehouseId,
          details: { create: spec.details },
        },
      });
      this.logger.log(
        `Outbound ${spec.type} discrepancy recorded for picking ${pk.pickingCode}`,
      );
    }
  }

  // Validate a per-item multi-bin split: a bin can be chosen at most once per
  // source item, and the summed qty across that item's bins must not exceed its
  // remaining. `keyOf` maps a row to its source item id; `metaOf` returns the
  // item's remaining and a human label for error messages.
  private validateItemBinSplit<T extends { binId: string; requestQty: number }>(
    rows: T[],
    keyOf: (row: T) => string,
    metaOf: (row: T) => { remaining: number; label: string },
  ) {
    const agg = new Map<
      string,
      { total: number; bins: Set<string>; remaining: number; label: string }
    >();
    for (const row of rows) {
      const key = keyOf(row);
      const meta = metaOf(row);
      const entry =
        agg.get(key) ??
        { total: 0, bins: new Set<string>(), remaining: meta.remaining, label: meta.label };
      if (entry.bins.has(row.binId)) {
        throw new BadRequestException(
          `The same bin is selected more than once for "${meta.label}"`,
        );
      }
      entry.bins.add(row.binId);
      entry.total += row.requestQty;
      agg.set(key, entry);
    }
    for (const entry of agg.values()) {
      if (entry.total > entry.remaining + 1e-9) {
        throw new BadRequestException(
          `Total picking qty (${entry.total}) across bins exceeds remaining (${entry.remaining}) for "${entry.label}"`,
        );
      }
    }
  }

  // ---------- inventory helpers ----------

  // material_code -> [{ bin_id, bin_label, avail_qty }] with avail_qty > 0.
  private async availableBinsByMaterial(
    warehouseId: string | null,
    materialCodes: string[],
  ) {
    const map = new Map<
      string,
      { bin_id: string | null; bin_label: string | null; avail_qty: number }[]
    >();
    if (materialCodes.length === 0) return map;

    const invs = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId, materialCode: { in: materialCodes } },
      include: {
        binStocks: {
          where: { availQty: { gt: 0 } },
          include: { bin: { select: { id: true, binLabel: true } } },
        },
      },
    });
    for (const inv of invs) {
      map.set(
        inv.materialCode,
        inv.binStocks.map((bs) => ({
          bin_id: bs.binId,
          bin_label: bs.bin?.binLabel ?? null,
          avail_qty: bs.availQty,
        })),
      );
    }
    return map;
  }

  // (material_code + bin_id) -> avail_qty, for the picking detail view.
  private async binAvailability(
    warehouseId: string | null,
    materialCodes: string[],
  ) {
    const map = new Map<string, number>();
    if (materialCodes.length === 0) return map;
    const invs = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId, materialCode: { in: materialCodes } },
      include: { binStocks: true },
    });
    for (const inv of invs) {
      for (const bs of inv.binStocks) {
        map.set(`${inv.materialCode}|${bs.binId ?? ''}`, bs.availQty);
      }
    }
    return map;
  }

  // ---------- serializers ----------

  private serializeList(p: PickingList) {
    return {
      id: p.id,
      picking_id: p.pickingCode,
      source_type: p.sourceType,
      so_id: p.salesOrder?.id ?? null,
      so_number: p.salesOrder?.tranId ?? null,
      // For Transfer Order source: TO number + destination.
      to_id: p.transferOrder?.id ?? null,
      to_number: p.transferOrder?.tranId ?? null,
      // Unified "reference number" (SO or TO) for shared list rendering.
      source_number: p.salesOrder?.tranId ?? p.transferOrder?.tranId ?? null,
      location: p.warehouse?.name ?? null,
      customer:
        p.salesOrder?.customerName ?? p.transferOrder?.toLocationName ?? null,
      status: p.status,
      item_count: p._count.items,
      created_at: p.createdAt,
    };
  }

  private serializeDetail(p: PickingDetail, availByMatBin: Map<string, number>) {
    const totals = p.items.reduce(
      (a, it) => ({
        request: a.request + it.requestQty,
        actual: a.actual + it.actualQty,
        qty_issue: a.qty_issue + it.qtyIssue,
        quality_issue: a.quality_issue + it.qualityIssue,
        remaining: a.remaining + it.remainingQty,
      }),
      { request: 0, actual: 0, qty_issue: 0, quality_issue: 0, remaining: 0 },
    );
    return {
      id: p.id,
      picking_id: p.pickingCode,
      source_type: p.sourceType,
      so_id: p.salesOrder?.id ?? null,
      so_number: p.salesOrder?.tranId ?? null,
      to_id: p.transferOrder?.id ?? null,
      to_number: p.transferOrder?.tranId ?? null,
      source_number: p.salesOrder?.tranId ?? p.transferOrder?.tranId ?? null,
      location: p.warehouse?.name ?? null,
      customer:
        p.salesOrder?.customerName ?? p.transferOrder?.toLocationName ?? null,
      status: p.status,
      created_at: p.createdAt,
      totals,
      items: p.items.map((it) => ({
        id: it.id,
        status: it.status,
        material_code: it.materialCode,
        material_name: it.materialName,
        bin_available_qty:
          availByMatBin.get(`${it.materialCode ?? ''}|${it.binId ?? ''}`) ?? 0,
        request_qty: it.requestQty,
        actual_qty: it.actualQty,
        qty_issue: it.qtyIssue,
        quality_issue: it.qualityIssue,
        remaining_qty: it.remainingQty,
        bin_id: it.binId,
        bin_label: it.bin?.binLabel ?? null,
        picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
      })),
    };
  }
}
