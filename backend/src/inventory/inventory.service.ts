import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustBinsDto } from './dto/adjust-bins.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { loadPibMrn } from '../goods-receive/gr-source.util';

type InvOrder = Prisma.InventoryManagementOrderByWithRelationInput;
// Only real columns are server-sortable; the quantity columns are aggregates
// computed from bin stocks and cannot be ordered by Prisma.
const INVENTORY_SORTABLE: Record<string, (d: SortDir) => InvOrder> = {
  material_code: (d) => ({ materialCode: d }),
  material_type: (d) => ({ material: { materialType: { materialTypeName: d } } }),
  material_category: (d) => ({
    material: { materialCategory: { materialCategoryName: d } },
  }),
  primary_uom: (d) => ({ material: { primaryUom: { uomCode: d } } }),
  warehouse_name: (d) => ({ warehouse: { name: d } }),
};

export interface WarehouseScope {
  // Controllers pass the full AuthUser, so the acting user is available for the
  // stock ledger; optional because older call sites do not set it.
  userId?: number;
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

const listInclude = {
  ...materialInclude,
  binStocks: {
    select: {
      reservedQty: true,
      availQty: true,
      inTransitQty: true,
      qualityIssue: true,
      qtyIssue: true,
    },
  },
} satisfies Prisma.InventoryManagementInclude;

const detailInclude = {
  ...materialInclude,
  binStocks: {
    include: { bin: { select: { binLabel: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.InventoryManagementInclude;

type InvList = Prisma.InventoryManagementGetPayload<{
  include: typeof listInclude;
}>;
type InvDetail = Prisma.InventoryManagementGetPayload<{
  include: typeof detailInclude;
}>;

interface StockDelta {
  avail?: number;
  reserved?: number;
  inTransit?: number;
  quality?: number;
  qtyIssue?: number;
}

/** Who/what caused a stock movement — required on every adjustBinStock call. */
export interface StockMovementSource {
  module:
    | 'inventory-adjustment'
    | 'goods-receive'
    | 'putaway'
    | 'picking'
    | 'packing'
    | 'delivery'
    | 'manual'
    | 'erp-sync';
  /** Primary key of the source document. */
  id?: string | null;
  /** Human-readable document number, so the ledger reads without a join. */
  number?: string | null;
  actorId?: number | null;
  note?: string | null;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.InventoryManagementWhereInput {
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
      INVENTORY_SORTABLE,
      { materialCode: 'asc' },
    );

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

  // ---------- manual bin adjustment ----------

  // Redistribute the available quantity across bins. The sum of the submitted
  // avail_qty must exactly equal the current total available (only availQty is
  // touched; reserved/in-transit/issue quantities are left untouched). Atomic.
  async adjustBins(id: string, dto: AdjustBinsDto, scope: WarehouseScope) {
    const inv = await this.prisma.inventoryManagement.findUnique({
      where: { id },
      include: { binStocks: true },
    });
    if (
      !inv ||
      (scope.role !== 'admin' && inv.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Inventory ${id} not found`);
    }

    const lines = dto.bins ?? [];

    // --- validate: no duplicate bins (treat null as a single "no bin" key) ---
    const seen = new Set<string>();
    for (const l of lines) {
      const key = l.bin_id ?? '__null__';
      if (seen.has(key)) {
        throw new BadRequestException('Duplicate bin in the submitted list');
      }
      seen.add(key);
      if (!(l.avail_qty >= 0)) {
        throw new BadRequestException('Quantity must not be negative');
      }
    }

    // --- validate: submitted bins exist and belong to this warehouse ---
    const binIds = lines
      .map((l) => l.bin_id)
      .filter((b): b is string => !!b);
    if (binIds.length > 0) {
      const bins = await this.prisma.bin.findMany({
        where: { id: { in: binIds } },
        select: { id: true, warehouseId: true },
      });
      const found = new Map(bins.map((b) => [b.id, b.warehouseId]));
      for (const b of binIds) {
        const wh = found.get(b);
        if (wh === undefined) {
          throw new BadRequestException(`Bin ${b} not found`);
        }
        if (inv.warehouseId && wh !== inv.warehouseId) {
          throw new BadRequestException(
            'Bin does not belong to this warehouse',
          );
        }
      }
    }

    // --- validate: total must match current available exactly ---
    const currentTotal = inv.binStocks.reduce((a, b) => a + b.availQty, 0);
    const newTotal = lines.reduce((a, l) => a + l.avail_qty, 0);
    if (Math.abs(newTotal - currentTotal) > 1e-9) {
      throw new BadRequestException(
        `Total bin quantity (${newTotal}) must equal total available (${currentTotal})`,
      );
    }

    // --- apply atomically: only availQty is modified ---
    const existingByBin = new Map(
      inv.binStocks.map((bs) => [bs.binId ?? '__null__', bs]),
    );
    // The manual editor sets availQty to an absolute value, so the ledger delta
    // is (new - old); every other bucket is left untouched.
    const manualSource = {
      module: 'manual' as const,
      id,
      note: 'Bin quantities edited manually',
      actorId: scope.userId ?? null,
    };
    const noChange = { reserved: 0, inTransit: 0, quality: 0, qtyIssue: 0 };

    await this.prisma.$transaction(async (tx) => {
      // Update / create the submitted bins.
      for (const l of lines) {
        const key = l.bin_id ?? '__null__';
        const existing = existingByBin.get(key);
        if (existing) {
          if (existing.availQty !== l.avail_qty) {
            const row = await tx.inventoryBinStock.update({
              where: { id: existing.id },
              data: { availQty: l.avail_qty },
            });
            await this.recordMovement(
              tx,
              id,
              l.bin_id ?? null,
              { ...noChange, avail: l.avail_qty - existing.availQty },
              {
                avail: row.availQty,
                reserved: row.reservedQty,
                inTransit: row.inTransitQty,
                quality: row.qualityIssue,
                qtyIssue: row.qtyIssue,
              },
              manualSource,
            );
          }
        } else {
          const row = await tx.inventoryBinStock.create({
            data: {
              inventoryId: id,
              binId: l.bin_id ?? null,
              availQty: l.avail_qty,
            },
          });
          await this.recordMovement(
            tx,
            id,
            l.bin_id ?? null,
            { ...noChange, avail: l.avail_qty },
            {
              avail: row.availQty,
              reserved: row.reservedQty,
              inTransit: row.inTransitQty,
              quality: row.qualityIssue,
              qtyIssue: row.qtyIssue,
            },
            manualSource,
          );
        }
      }
      // Zero out availQty on existing bins that were dropped from the list.
      for (const [key, bs] of existingByBin) {
        if (!seen.has(key) && bs.availQty !== 0) {
          const row = await tx.inventoryBinStock.update({
            where: { id: bs.id },
            data: { availQty: 0 },
          });
          await this.recordMovement(
            tx,
            id,
            bs.binId,
            { ...noChange, avail: -bs.availQty },
            {
              avail: row.availQty,
              reserved: row.reservedQty,
              inTransit: row.inTransitQty,
              quality: row.qualityIssue,
              qtyIssue: row.qtyIssue,
            },
            { ...manualSource, note: 'Bin removed from the manual list' },
          );
        }
      }
    });

    return this.findOne(id, scope);
  }

  // ---------- generation (called when a GR is received) ----------

  async generateFromGoodsReceive(goodsReceiveId: string) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
    });
    if (!gr) return;

    const mrn = await loadPibMrn(this.prisma, gr);
    if (!mrn) return;

    let created = 0;
    for (const item of mrn.items) {
      if (!(item.qtyActual > 0)) continue;

      // Idempotent: skip items already taken into inventory.
      if (item.inventoriedAt) continue;

      // Material: join mrn_item.item_id -> materials.erp_doc_id
      const material =
        item.itemId != null
          ? await this.prisma.material.findUnique({
              where: { erpDocId: String(item.itemId) },
            })
          : null;
      const materialCode: string =
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

      const gap =
        item.qtyActual < item.qtyExpected
          ? item.qtyExpected - item.qtyActual
          : 0;

      // Per-bin stock: received qty lands in the receive bin, grouped per
      // (inventory, bin). Mark the item inventoried in the same transaction.
      const invId = inv.id;
      await this.prisma.$transaction(async (tx) => {
        await this.adjustBinStock(
          invId,
          item.binId ?? null,
          { avail: item.qtyActual, qtyIssue: gap },
          {
            module: 'goods-receive',
            id: goodsReceiveId,
            number: gr.grNumber,
            note: 'Inventory generated from Goods Receive',
          },
          tx,
        );
        await tx.mrnItem.update({
          where: { id: item.id },
          data: { inventoriedAt: new Date() },
        });
      });
      created++;
    }
    this.logger.log(
      `Inventory generated for GR ${goodsReceiveId}: ${created} batch(es)`,
    );
    return { created };
  }

  // Increment a bin's stock by the given deltas (negative = decrease),
  // creating the (inventory, bin) row if needed. Accepts a tx client.
  //
  // Every caller must say which document caused the movement: this is the single
  // choke point for GR, putaway, picking, packing and delivery, so it is also
  // where the stock ledger is written (FR-IA-14 rule 4 / NFR-IA-L-05).
  async adjustBinStock(
    inventoryId: string,
    binId: string | null,
    d: StockDelta,
    source: StockMovementSource,
    client?: Prisma.TransactionClient,
  ) {
    const c = client ?? this.prisma;
    const existing = await c.inventoryBinStock.findFirst({
      where: { inventoryId, binId },
    });

    const delta = {
      avail: d.avail ?? 0,
      reserved: d.reserved ?? 0,
      inTransit: d.inTransit ?? 0,
      quality: d.quality ?? 0,
      qtyIssue: d.qtyIssue ?? 0,
    };

    let after: {
      avail: number;
      reserved: number;
      inTransit: number;
      quality: number;
      qtyIssue: number;
    };

    if (existing) {
      const row = await c.inventoryBinStock.update({
        where: { id: existing.id },
        data: {
          availQty: { increment: delta.avail },
          reservedQty: { increment: delta.reserved },
          inTransitQty: { increment: delta.inTransit },
          qualityIssue: { increment: delta.quality },
          qtyIssue: { increment: delta.qtyIssue },
        },
      });
      after = {
        avail: row.availQty,
        reserved: row.reservedQty,
        inTransit: row.inTransitQty,
        quality: row.qualityIssue,
        qtyIssue: row.qtyIssue,
      };
    } else {
      const row = await c.inventoryBinStock.create({
        data: {
          inventoryId,
          binId,
          availQty: delta.avail,
          reservedQty: delta.reserved,
          inTransitQty: delta.inTransit,
          qualityIssue: delta.quality,
          qtyIssue: delta.qtyIssue,
        },
      });
      after = {
        avail: row.availQty,
        reserved: row.reservedQty,
        inTransit: row.inTransitQty,
        quality: row.qualityIssue,
        qtyIssue: row.qtyIssue,
      };
    }

    await this.recordMovement(c, inventoryId, binId, delta, after, source);
  }

  /**
   * Append one ledger row. A movement that changes nothing is not recorded, and
   * a ledger failure never rolls back the stock change it describes.
   */
  async recordMovement(
    c: Prisma.TransactionClient | PrismaService,
    inventoryId: string,
    binId: string | null,
    delta: {
      avail: number;
      reserved: number;
      inTransit: number;
      quality: number;
      qtyIssue: number;
    },
    after: {
      avail: number;
      reserved: number;
      inTransit: number;
      quality: number;
      qtyIssue: number;
    },
    source: StockMovementSource,
  ) {
    const moved =
      delta.avail || delta.reserved || delta.inTransit || delta.quality || delta.qtyIssue;
    if (!moved) return;

    try {
      const inv = await c.inventoryManagement.findUnique({
        where: { id: inventoryId },
        select: { warehouseId: true, materialId: true, materialCode: true },
      });
      await c.stockMovement.create({
        data: {
          inventoryId,
          binId,
          warehouseId: inv?.warehouseId ?? null,
          materialId: inv?.materialId ?? null,
          materialCode: inv?.materialCode ?? null,
          deltaAvail: delta.avail,
          deltaReserved: delta.reserved,
          deltaInTransit: delta.inTransit,
          deltaQuality: delta.quality,
          deltaQtyIssue: delta.qtyIssue,
          availAfter: after.avail,
          reservedAfter: after.reserved,
          inTransitAfter: after.inTransit,
          qualityAfter: after.quality,
          qtyIssueAfter: after.qtyIssue,
          sourceModule: source.module,
          sourceId: source.id ?? null,
          sourceNumber: source.number ?? null,
          note: source.note ?? null,
          actorId: source.actorId ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Could not write the stock ledger for inventory ${inventoryId}: ${(e as Error).message}`,
      );
    }
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

  private oracleHeaderFields(m: InvList | InvDetail) {
    return {
      qty_committed: m.qtyCommitted,
      qty_on_order: m.qtyOnOrder,
      qty_back_order: m.qtyBackOrder,
      qty_in_transit: m.qtyInTransit,
    };
  }

  private serializeList(m: InvList) {
    return {
      id: m.id,
      ...this.materialFields(m),
      ...this.oracleHeaderFields(m),
      ...this.sumBatches(m.binStocks),
      // In Transit is tracked at header level (Oracle-mirrored), not per bin.
      in_transit_qty: m.qtyInTransit,
    };
  }

  private serializeDetail(m: InvDetail) {
    // One row per bin location (quantities already stored per bin).
    const bins = m.binStocks
      .map((bs) => ({
        bin_id: bs.binId ?? null,
        bin_location: bs.bin?.binLabel ?? null,
        warehouse_name: m.warehouse?.name ?? null,
        ...this.sumBatches([bs]),
      }))
      // Hide bins that are fully empty.
      .filter(
        (b) =>
          b.reserved_qty !== 0 ||
          b.avail_qty !== 0 ||
          b.in_transit_qty !== 0 ||
          b.quality_issue !== 0 ||
          b.qty_issue !== 0,
      )
      .sort((a, b) =>
        (a.bin_location ?? '').localeCompare(b.bin_location ?? ''),
      );

    return {
      id: m.id,
      warehouse_id: m.warehouseId ?? null,
      ...this.materialFields(m),
      ...this.oracleHeaderFields(m),
      ...this.sumBatches(m.binStocks),
      // In Transit is tracked at header level (Oracle-mirrored), not per bin.
      in_transit_qty: m.qtyInTransit,
      bins,
    };
  }
}
