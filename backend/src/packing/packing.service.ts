import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { highestSeq } from '../common/doc-sequence';
import { InventoryService } from '../inventory/inventory.service';
import { reopenPicking } from '../common/outbound-revert';
import type { GeneratePackingDto } from './dto/generate-packing.dto';
import type { ProgressPackingDto } from './dto/progress-packing.dto';
import type { QueryPackingDto } from './dto/query-packing.dto';
import type { OutboundDocFilterField } from '../picking/dto/query-picking.dto';
import { outboundBinSelect, outboundMaterialSelect } from '../picking/picking.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { scopeWhere, inScope } from '../common/warehouse-scope';

type PackingOrder = Prisma.PackingOrderByWithRelationInput;
const PACKING_SORTABLE: Record<string, (d: SortDir) => PackingOrder> = {
  packing_code: (d) => ({ packingCode: d }),
  picking_id: (d) => ({ picking: { pickingCode: d } }),
  so_number: (d) => ({ picking: { salesOrder: { tranId: d } } }),
  location: (d) => ({ warehouse: { name: d } }),
  customer: (d) => ({ picking: { salesOrder: { customerName: d } } }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
  updated_at: (d) => ({ updatedAt: d }),
  created_by: (d) => ({ createdBy: { name: d } }),
};

const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

/** A condition on a packing's source order (through its pickings). */
const viaPickings = (w: Prisma.PickingWhereInput): Prisma.PackingWhereInput => ({ pickings: { some: w } });

/** One value of one list filter as a packing condition (values OR-ed, fields AND-ed). */
const PACKING_FILTERS: Record<OutboundDocFilterField, (v: string) => Prisma.PackingWhereInput> = {
  material_code: (v) => ({ items: { some: { OR: [{ materialCode: ci(v) }, { material: { materialCode: ci(v) } }] } } }),
  material_name: (v) => ({ items: { some: { OR: [{ materialName: ci(v) }, { material: { materialName: ci(v) } }] } } }),
  warehouse_name: (v) => ({ warehouse: { name: ci(v) } }),
  customer_name: (v) =>
    viaPickings({ OR: [{ salesOrder: { customerName: ci(v) } }, { transferOrder: { toLocationName: ci(v) } }] }),
  tran_id: (v) => viaPickings({ OR: [{ salesOrder: { tranId: ci(v) } }, { transferOrder: { tranId: ci(v) } }] }),
  outbound_id: (v) =>
    viaPickings({ OR: [{ salesOrder: { outboundId: ci(v) } }, { transferOrder: { outboundId: ci(v) } }] }),
  picking_code: (v) => viaPickings({ pickingCode: ci(v) }),
  packing_code: (v) => ({ packingCode: ci(v) }),
  delivery_code: (v) => ({ deliveryItems: { some: { delivery: { deliveryCode: ci(v) } } } }),
  created_by_name: (v) => ({ createdBy: { name: ci(v) } }),
};

export interface WarehouseScope {
  // Controllers pass the full AuthUser, so the acting user is available for the
  // stock ledger; optional because older call sites do not set it.
  userId?: number;
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

const headerInclude = {
  warehouse: { select: { id: true, name: true, subsidiaryName: true } },
  picking: {
    select: {
      pickingCode: true,
      salesOrder: { select: { id: true, tranId: true, outboundId: true, customerName: true } },
      transferOrder: { select: { id: true, tranId: true, outboundId: true, toLocationName: true } },
    },
  },
  // Every picking merged into this packing ("PICK-… +1").
  pickings: { select: { id: true, pickingCode: true }, orderBy: { pickingCode: 'asc' as const } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.PackingInclude;

const itemsInclude = {
  include: {
    material: { select: outboundMaterialSelect },
    bin: { select: outboundBinSelect },
    picker: { select: { id: true, name: true } },
    // The Picking Bin the line came from.
    pickingItem: { select: { bin: { select: { binLabel: true } } } },
  },
  orderBy: { createdAt: 'asc' as const },
} satisfies Prisma.Packing$itemsArgs;

const listInclude = {
  ...headerInclude,
  _count: { select: { items: true } },
} satisfies Prisma.PackingInclude;

const detailInclude = {
  ...headerInclude,
  items: itemsInclude,
} satisfies Prisma.PackingInclude;

type PackingHeader = Prisma.PackingGetPayload<{ include: typeof headerInclude }>;
type PackingList = Prisma.PackingGetPayload<{ include: typeof listInclude }>;
type PackingDetail = Prisma.PackingGetPayload<{ include: typeof detailInclude }>;
type PackingLine = Prisma.PackingItemGetPayload<typeof itemsInclude>;

@Injectable()
export class PackingService {
  private readonly logger = new Logger(PackingService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

  private scopeWhere(scope: WarehouseScope): Prisma.PackingWhereInput {
    return scopeWhere(scope, 'warehouseId');
  }

  // ---------- read ----------

  async findAll(query: QueryPackingDto, scope: WarehouseScope) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, PACKING_SORTABLE, {
      createdAt: 'desc',
    });

    // Packings that already have a Delivery document are hidden (they move to
    // the Delivery List tab).
    const where: Prisma.PackingWhereInput = {
      ...this.scopeWhere(scope),
      // A packing is done once any delivery covers it.
      deliveries: { none: {} },
      deliveryItems: { none: {} },
    };
    if (query.source === 'SALES_ORDER' || query.source === 'TRANSFER_ORDER') {
      where.sourceType = query.source;
    }
    if (query.search) {
      where.OR = [
        { packingCode: { contains: query.search, mode: 'insensitive' } },
        { picking: { pickingCode: { contains: query.search, mode: 'insensitive' } } },
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

    // Packings have no On Progress: they are Open until every line is packed.
    if (query.status === 'Open' || query.status === 'Closed') where.status = query.status;
    const and: Prisma.PackingWhereInput[] = [];
    for (const f of query.filters ?? []) {
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (values.length) and.push({ OR: values.map(PACKING_FILTERS[f.field]) });
    }
    if (and.length) where.AND = and;

    const withItems = query.include_items === 'true';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.packing.count({ where }),
      this.prisma.packing.findMany({
        where,
        include: withItems ? { ...listInclude, items: itemsInclude } : listInclude,
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
      rows: rows.map((r) => ({
        ...this.serializeList(r),
        ...(withItems ? { items: ((r as unknown as { items: PackingLine[] }).items).map((it) => this.serializeLine(it, r)) } : {}),
      })),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const pk = await this.prisma.packing.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !pk ||
      (scope.role !== 'admin' && !inScope(scope, pk.warehouseId))
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
      ...scopeWhere(scope),
    };

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
      if (scope.role !== 'admin' && !inScope(scope, p.warehouseId)) {
        throw new NotFoundException(`Picking ${id} not found`);
      }
      if (p.status !== 'Closed') {
        throw new BadRequestException(
          `Only Closed pickings can be packed (${p.pickingCode} is ${p.status})`,
        );
      }
      // packingId covers merged membership; p.packing covers being a primary.
      if (p.packingId || p.packing) {
        throw new BadRequestException(
          `Picking ${p.pickingCode} already has a packing document`,
        );
      }
    }

    // All selected pickings must come from the SAME source document (one SO or
    // one TO) — they merge into a single packing.
    const first = byId.get(dto.pickingIds[0])!;
    const sameSource = dto.pickingIds.every((id) => {
      const p = byId.get(id)!;
      return (
        p.sourceType === first.sourceType &&
        p.salesOrderId === first.salesOrderId &&
        p.transferOrderId === first.transferOrderId
      );
    });
    if (!sameSource) {
      throw new BadRequestException(
        'All selected pickings must belong to the same Sales Order / Transfer Order',
      );
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseCount = highestSeq(
      (
        await this.prisma.packing.findMany({
          where: { packingCode: { startsWith: `PACK-${today}` } },
          select: { packingCode: true },
        })
      ).map((r) => r.packingCode),
    );

    const createdCodes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const packingCode = `PACK-${today}-${String(baseCount + 1).padStart(3, '0')}`;
      // One packing for all selected pickings; detail = union of their items,
      // carrying only the actually-picked qty.
      const items = dto.pickingIds
        .flatMap((id) => byId.get(id)!.items)
        .filter((it) => it.actualQty > 0)
        .map((it) => ({
          // Carry the source line reference (SO or TO) through from picking.
          salesOrderItemId: it.salesOrderItemId,
          transferOrderItemId: it.transferOrderItemId,
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          qty: it.actualQty, // base = picking actual qty
          remainingQty: it.actualQty, // nothing packed yet
          binId: it.binId,
          pickingItemId: it.id, // the picking line, for its Picking Bin
          pickerId: it.pickerId,
        }));
      const packing = await tx.packing.create({
        data: {
          packingCode,
          sourceType: first.sourceType, // inherit source (same for all members)
          pickingId: first.id, // primary picking (first selected)
          warehouseId: first.warehouseId,
          status: 'Open',
          createdById: scope.userId ?? null,
          items: { create: items },
        },
      });
      // Mark every selected picking as a member of this packing — this is what
      // removes them from the "packable" picking list.
      await tx.picking.updateMany({
        where: { id: { in: dto.pickingIds } },
        data: { packingId: packing.id },
      });
      createdCodes.push(packingCode);
    });

    this.logger.log(
      `Generated ${createdCodes.length} packing(s): ${createdCodes.join(', ')}`,
    );
    return { created: createdCodes.length, packing_codes: createdCodes };
  }

  // ---------- delete ----------

  /**
   * Delete an Open packing. Every picking it was made from goes back to Open
   * with its progress cleared, so it is picked again: the stock a closed
   * picking had moved into the issue buckets returns to Reserved and its
   * discrepancies are removed. (An Open packing has not touched stock itself.)
   */
  async remove(id: string, scope: WarehouseScope) {
    const pk = await this.prisma.packing.findUnique({
      where: { id },
      include: {
        pickings: { select: { id: true } },
        _count: { select: { deliveries: true, deliveryItems: true } },
      },
    });
    if (!pk || (scope.role !== 'admin' && !inScope(scope, pk.warehouseId))) {
      throw new NotFoundException(`Packing ${id} not found`);
    }
    if (pk.status !== 'Open') {
      throw new BadRequestException(
        `Only an Open packing can be deleted (current: ${pk.status})`,
      );
    }
    if (pk._count.deliveries || pk._count.deliveryItems) {
      throw new BadRequestException(`Packing ${pk.packingCode} is on a delivery plan`);
    }

    const pickingIds = [...new Set([pk.pickingId, ...pk.pickings.map((p) => p.id)])];
    await this.prisma.$transaction(async (tx) => {
      // Reopen first: it also detaches the pickings from this packing.
      for (const pickingId of pickingIds) {
        await reopenPicking(
          tx,
          this.inventory,
          pickingId,
          scope.userId,
          `Packing ${pk.packingCode} deleted — picking reopened`,
        );
      }
      await tx.packing.delete({ where: { id } });
    });

    this.logger.log(
      `Packing ${pk.packingCode} deleted; ${pickingIds.length} picking(s) reopened`,
    );
    return { deleted: true, reopened_pickings: pickingIds.length };
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
      (scope.role !== 'admin' && !inScope(scope, pk.warehouseId))
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

      // Who recorded this progress (also bumps Last Modified At).
      await tx.packing.update({ where: { id }, data: { updatedById: scope.userId ?? null } });

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
          {
            module: 'packing',
            id: pk.id,
            number: pk.packingCode,
            actorId: scope.userId,
            note: 'Packing discrepancy moved out of reserved',
          },
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
      const count = highestSeq(
        (
          await this.prisma.discrepancy.findMany({
            where: { discrepancyId: { startsWith: `DISC-${today}` } },
            select: { discrepancyId: true },
          })
        ).map((r) => r.discrepancyId),
      );
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

  /** The header fields the list, the detail and the accordion share. */
  private serializeHeader(p: PackingHeader) {
    const so = p.picking?.salesOrder;
    const to = p.picking?.transferOrder;
    return {
      id: p.id,
      packing_id: p.packingCode,
      source_type: p.sourceType,
      picking_id: p.picking?.pickingCode ?? null,
      // Every merged picking, primary first.
      pickings: p.pickings
        .map((pk) => ({ id: pk.id, picking_id: pk.pickingCode }))
        .sort((a, b) => Number(b.picking_id === p.picking?.pickingCode) - Number(a.picking_id === p.picking?.pickingCode)),
      so_id: so?.id ?? null,
      so_number: so?.tranId ?? null,
      to_id: to?.id ?? null,
      to_number: to?.tranId ?? null,
      source_number: so?.tranId ?? to?.tranId ?? null,
      // WMS's outbound number of the order ("SO ID" on WMS dev).
      outbound_id: so?.outboundId ?? to?.outboundId ?? null,
      customer: so?.customerName ?? to?.toLocationName ?? null,
      location: p.warehouse?.name ?? null,
      warehouse_id: p.warehouse?.id ?? null,
      ownership: p.warehouse?.subsidiaryName ?? null,
      status: p.status,
      created_by: p.createdBy?.name ?? null,
      created_at: p.createdAt,
      updated_by: p.updatedBy?.name ?? null,
      updated_at: p.updatedAt,
    };
  }

  private serializeList(p: PackingList) {
    return { ...this.serializeHeader(p), item_count: p._count.items };
  }

  private serializeLine(it: PackingLine, p: { updatedAt: Date; updatedBy?: { name: string } | null }) {
    const handled = it.actualQty + it.qtyIssue + it.qualityIssue;
    return {
      id: it.id,
      material_code: it.materialCode ?? it.material?.materialCode ?? null,
      material_name: it.materialName ?? it.material?.materialName ?? null,
      material_type: it.material?.materialType?.materialTypeName ?? null,
      material_category: it.material?.materialCategory?.materialCategoryName ?? null,
      material_weight: it.material?.materialWeight ?? null,
      uom: it.material?.primaryUom?.uomCode ?? null,
      qty: it.qty, // base (target to pack)
      actual_qty: it.actualQty,
      qty_issue: it.qtyIssue,
      quality_issue: it.qualityIssue,
      remaining_qty: it.remainingQty,
      bin_label: it.bin?.binLabel ?? it.pickingItem?.bin?.binLabel ?? null,
      picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
      // Lines carry no audit of their own: a packed line shows the packing's last change.
      updated_by: handled > 0 ? (p.updatedBy?.name ?? null) : null,
      updated_at: handled > 0 ? p.updatedAt : null,
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
      ...this.serializeHeader(p),
      totals,
      items: p.items.map((it) => this.serializeLine(it, p)),
    };
  }
}
