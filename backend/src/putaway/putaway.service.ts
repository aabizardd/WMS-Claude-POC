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
import type { GeneratePutawayDto } from './dto/generate-putaway.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { findGrForMrn } from '../goods-receive/gr-source.util';
import { scopeWhere, inScope } from '../common/warehouse-scope';

type PutawayOrder = Prisma.PutawayOrderByWithRelationInput;
const PUTAWAY_SORTABLE: Record<string, (d: SortDir) => PutawayOrder> = {
  putaway_code: (d) => ({ putawayCode: d }),
  gr_number: (d) => ({ goodsReceive: { grNumber: d } }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
};

export interface WarehouseScope {
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

const listInclude = {
  goodsReceive: { select: { grNumber: true } },
  warehouse: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PutawayInclude;

const detailInclude = {
  goodsReceive: { select: { grNumber: true } },
  warehouse: { select: { id: true, name: true } },
  items: {
    include: {
      mrnItem: { select: { qtyRemaining: true } },
      grItem: { select: { qtyRemaining: true } },
      picker: { select: { id: true, name: true } },
      bin: { select: { id: true, binLabel: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.PutawayInclude;

type PutawayList = Prisma.PutawayGetPayload<{ include: typeof listInclude }>;
type PutawayDetail = Prisma.PutawayGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class PutawayService {
  private readonly logger = new Logger(PutawayService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

  private scopeWhere(scope: WarehouseScope): Prisma.PutawayWhereInput {
    return scopeWhere(scope, 'warehouseId');
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      history?: string | boolean;
      /** GR source (PIB / TO) — keeps each inbound door's putaways apart. */
      source?: string;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, PUTAWAY_SORTABLE, {
      createdAt: 'desc',
    });

    const where: Prisma.PutawayWhereInput = { ...this.scopeWhere(scope) };
    // History tab = Closed only; Putaway tab = active (Open / OnProgress).
    const isHistory = query.history === true || query.history === 'true';
    where.status = isHistory ? 'Closed' : { not: 'Closed' };
    if (query.source === 'PIB' || query.source === 'TO') {
      where.goodsReceive = { sourceType: query.source };
    }
    if (query.search) {
      where.OR = [
        { putawayCode: { contains: query.search, mode: 'insensitive' } },
        {
          goodsReceive: {
            grNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.putaway.count({ where }),
      this.prisma.putaway.findMany({
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
    const pt = await this.prisma.putaway.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !pt ||
      (scope.role !== 'admin' && !inScope(scope, pt.warehouseId))
    ) {
      throw new NotFoundException(`Putaway ${id} not found`);
    }
    return this.serializeDetail(pt);
  }

  async generate(dto: GeneratePutawayDto) {
    let goodsReceiveId: string | null = null;
    let warehouseId: string | null = null;
    const itemRows: {
      mrnItemId: string | null;
      grItemId: string | null;
      plannedQty: number;
      pickerId: number | null;
      binId: string;
      itemName: string | null;
      poNumber: string | null;
      vendorName: string | null;
      materialCode: string | null;
    }[] = [];

    for (const row of dto.items) {
      if (!row.binId) {
        throw new BadRequestException('Please select Destination Bin for all selected materials');
      }
      // TO source: the line is a Goods Receive item.
      if (row.grItemId) {
        const grItem = await this.prisma.goodsReceiveItem.findUnique({
          where: { id: row.grItemId },
          include: { goodsReceive: { select: { id: true, warehouseId: true, sourceDocNumber: true } } },
        });
        if (!grItem) throw new BadRequestException(`Goods Receive item ${row.grItemId} not found`);
        if (row.plannedQty <= 0) {
          throw new BadRequestException(`Planned qty must be > 0 for item ${row.grItemId}`);
        }
        if (row.plannedQty > grItem.qtyRemaining + 1e-9) {
          throw new BadRequestException(
            `Planned qty (${row.plannedQty}) exceeds remaining (${grItem.qtyRemaining}) for "${grItem.materialCode ?? grItem.itemDisplay ?? row.grItemId}"`,
          );
        }
        if (!goodsReceiveId) {
          goodsReceiveId = grItem.goodsReceive.id;
          warehouseId = grItem.goodsReceive.warehouseId;
        } else if (goodsReceiveId !== grItem.goodsReceive.id) {
          throw new BadRequestException(`All items must belong to the same Goods Receive`);
        }
        itemRows.push({
          mrnItemId: null,
          grItemId: grItem.id,
          plannedQty: row.plannedQty,
          pickerId: row.pickerId ?? null,
          binId: row.binId,
          itemName: grItem.itemDisplay,
          poNumber: grItem.goodsReceive.sourceDocNumber,
          vendorName: null,
          materialCode: grItem.materialCode,
        });
        continue;
      }
      if (!row.mrnItemId) throw new BadRequestException('Each item needs mrnItemId or grItemId');
      const mrnItem = await this.prisma.mrnItem.findUnique({
        where: { id: row.mrnItemId },
      });
      if (!mrnItem) {
        throw new BadRequestException(`MRN item ${row.mrnItemId} not found`);
      }
      if (row.plannedQty <= 0) {
        throw new BadRequestException(
          `Planned qty must be > 0 for item ${row.mrnItemId}`,
        );
      }
      if (row.plannedQty > mrnItem.qtyRemaining) {
        throw new BadRequestException(
          `Planned qty (${row.plannedQty}) exceeds remaining (${mrnItem.qtyRemaining}) for "${mrnItem.itemName ?? row.mrnItemId}"`,
        );
      }
      // GR that this MRN backs (PIB source: sourceDocId = mrn.id).
      const grRef = await findGrForMrn(this.prisma, mrnItem.mrnId);
      if (!grRef) {
        throw new BadRequestException(
          `MRN item ${row.mrnItemId} is not linked to a Goods Receive`,
        );
      }
      if (!goodsReceiveId) {
        goodsReceiveId = grRef.id;
        warehouseId = grRef.warehouseId;
      } else if (goodsReceiveId !== grRef.id) {
        throw new BadRequestException(
          `All items must belong to the same Goods Receive`,
        );
      }

      let materialCode: string | null = null;
      if (mrnItem.itemId != null) {
        const mat = await this.prisma.material.findUnique({
          where: { erpDocId: String(mrnItem.itemId) },
          select: { materialCode: true },
        });
        materialCode = mat?.materialCode ?? null;
      }

      itemRows.push({
        mrnItemId: mrnItem.id,
        grItemId: null,
        plannedQty: row.plannedQty,
        pickerId: row.pickerId ?? null,
        binId: row.binId,
        itemName: mrnItem.itemName,
        poNumber: mrnItem.poNumber,
        vendorName: mrnItem.vendorName,
        materialCode,
      });
    }

    if (itemRows.length === 0) {
      throw new BadRequestException('No valid items to putaway');
    }

    // Every destination bin must be an active bin of the receiving warehouse.
    const binIds = [...new Set(itemRows.map((it) => it.binId))];
    const bins = await this.prisma.bin.findMany({
      where: { id: { in: binIds } },
      select: { id: true, binLabel: true, warehouseId: true, isActive: true },
    });
    const binById = new Map(bins.map((b) => [b.id, b]));
    for (const id of binIds) {
      const b = binById.get(id);
      if (!b) throw new BadRequestException(`Destination bin ${id} not found`);
      if (!b.isActive) throw new BadRequestException(`Destination bin "${b.binLabel}" is inactive`);
      if (warehouseId && b.warehouseId !== warehouseId) {
        throw new BadRequestException(
          `Destination bin "${b.binLabel}" is not in the Goods Receive's warehouse`,
        );
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.putaway.count({
      where: { putawayCode: { startsWith: `PTW-${today}` } },
    });
    const seq = String(count + 1).padStart(3, '0');
    const putawayCode = `PTW-${today}-${seq}`;

    const hasPicker = itemRows.some((it) => it.pickerId != null);

    const putaway = await this.prisma.$transaction(async (tx) => {
      const created = await tx.putaway.create({
        data: {
          putawayCode,
          grId: goodsReceiveId,
          warehouseId,
          status: 'Open',
          items: {
            create: itemRows.map((it) => ({
              mrnItemId: it.mrnItemId,
              grItemId: it.grItemId,
              itemName: it.itemName,
              poNumber: it.poNumber,
              materialCode: it.materialCode,
              vendorName: it.vendorName,
              plannedQty: it.plannedQty,
              pickerId: it.pickerId,
              binId: it.binId,
            })),
          },
        },
        include: detailInclude,
      });

      for (const it of itemRows) {
        if (it.grItemId) {
          await tx.goodsReceiveItem.update({
            where: { id: it.grItemId },
            data: { qtyRemaining: { decrement: it.plannedQty } },
          });
          // Transfer IN: the received qty enters stock now, in the Destination Bin.
          await this.moveTransferStock(tx, it.grItemId, warehouseId, it.binId, it.plannedQty, {
            module: 'putaway',
            id: created.id,
            number: putawayCode,
            note: 'Generated putaway — stock into the destination bin',
          });
        } else if (it.mrnItemId) {
          await tx.mrnItem.update({
            where: { id: it.mrnItemId },
            data: { qtyRemaining: { decrement: it.plannedQty } },
          });
        }
      }

      if (hasPicker) {
        await tx.putaway.update({
          where: { id: created.id },
          data: { status: 'OnProgress' },
        });
      }

      return created;
    });

    return this.serializeDetail(
      (await this.prisma.putaway.findUnique({
        where: { id: putaway.id },
        include: detailInclude,
      }))!,
    );
  }

  async assignPicker(
    id: string,
    items: { id: string; pickerId: number | null }[],
  ) {
    const putaway = await this.prisma.putaway.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!putaway) {
      throw new NotFoundException(`Putaway ${id} not found`);
    }

    const validIds = new Set(putaway.items.map((it) => it.id));
    for (const row of items) {
      if (!validIds.has(row.id)) {
        throw new NotFoundException(
          `Item ${row.id} is not part of putaway ${id}`,
        );
      }
    }

    await this.prisma.$transaction(
      items.map((row) =>
        this.prisma.putawayItem.update({
          where: { id: row.id },
          data: {
            pickerId: row.pickerId,
          },
        }),
      ),
    );

    const hasAllPickers = (await this.prisma.putawayItem.count({
      where: { putawayId: id, pickerId: null },
    })) === 0;

    if (hasAllPickers) {
      await this.prisma.putaway.update({
        where: { id },
        data: { status: 'OnProgress' },
      });
    }

    const updated = await this.prisma.putaway.findUnique({
      where: { id },
      include: detailInclude,
    });

    return this.serializeDetail(updated!);
  }

  async confirm(
    id: string,
    items: { id: string; actualQty: number; qualityIssue: number; qtyIssue: number; binId: string | null }[],
  ) {
    const putaway = await this.prisma.putaway.findUnique({
      where: { id },
      include: { items: { include: { mrnItem: true, grItem: true } }, goodsReceive: true },
    });
    if (!putaway) throw new NotFoundException(`Putaway ${id} not found`);

    const itemMap = new Map(putaway.items.map((it) => [it.id, it]));
    for (const row of items) {
      const it = itemMap.get(row.id);
      if (!it) throw new Error(`Item ${row.id} is not part of putaway ${id}`);
      const total = row.actualQty + row.qualityIssue + row.qtyIssue;
      if (total > it.plannedQty) {
        throw new Error(
          `Total (${total}) exceeds planned qty (${it.plannedQty}) for "${it.itemName ?? row.id}"`,
        );
      }
    }

    let hasRemaining = false;
    // Transfer IN / Local Vendor (GR-line putaways): one confirm settles the
    // putaway — what was not handled has gone back to the GR to be put away on
    // a new putaway.
    const isTransfer = putaway.goodsReceive?.sourceType === 'TO' || putaway.goodsReceive?.sourceType === 'PO';
    if (isTransfer && putaway.status === 'Closed') {
      throw new BadRequestException(`Putaway ${putaway.putawayCode} is already Closed`);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of items) {
        const it = itemMap.get(row.id)!;
        const remaining = it.plannedQty - row.actualQty - row.qualityIssue - row.qtyIssue;
        if (remaining > 0) hasRemaining = true;

        await tx.putawayItem.update({
          where: { id: row.id },
          data: {
            actualQty: row.actualQty,
            qualityIssue: row.qualityIssue,
            qtyIssue: row.qtyIssue,
            remainingQty: remaining,
            // Transfer IN: the Destination Bin was fixed when it was generated.
            binId: it.grItemId ? it.binId : row.binId,
          },
        });

        // Add back unused qty to the source line's remaining.
        if (remaining > 0 && it.grItemId) {
          await tx.goodsReceiveItem.update({
            where: { id: it.grItemId },
            data: { qtyRemaining: { increment: remaining } },
          });
        } else if (remaining > 0 && it.mrnItemId) {
          await tx.mrnItem.update({
            where: { id: it.mrnItemId },
            data: { qtyRemaining: { increment: remaining } },
          });
        }

        // Move stock between bins. The receive bin (mrn_item.bin_id) loses the
        // full putaway amount; the destination bin gains avail + the issues.
        // Resolve the inventory row the same way it was keyed on receive:
        // (material_code, warehouse).
        const mrnItem = it.mrnItem;
        const grItem = it.grItem;
        if (grItem) {
          // Transfer IN: the planned qty already sits in the Destination Bin
          // (added on generate). Good qty stays available there; the issues move
          // to their buckets, and what was not handled leaves the bin again —
          // it goes back to the GR to be put away later.
          const inv = await this.transferInventory(tx, grItem, putaway.warehouseId);
          await this.inventory.adjustBinStock(
            inv.id,
            it.binId,
            {
              avail: -(row.qualityIssue + row.qtyIssue + remaining),
              quality: row.qualityIssue,
              qtyIssue: row.qtyIssue,
            },
            {
              module: 'putaway',
              id: putaway.id,
              number: putaway.putawayCode,
              note: 'Putaway confirmed in the destination bin',
            },
            tx,
          );
          continue;
        }
        let inv: { id: string } | null = null;
        let receiveBinId: string | null = null;
        if (mrnItem) {
          receiveBinId = mrnItem.binId;
          const material =
            mrnItem.itemId != null
              ? await tx.material.findUnique({
                  where: { erpDocId: String(mrnItem.itemId) },
                  select: { materialCode: true },
                })
              : null;
          const materialCode =
            material?.materialCode ??
            mrnItem.itemName ??
            `ITEM-${mrnItem.itemId}`;
          inv = await tx.inventoryManagement.findFirst({
            where: { materialCode, warehouseId: putaway.warehouseId },
            select: { id: true },
          });
        }
        if (inv) {
          const putawayTotal = row.actualQty + row.qualityIssue + row.qtyIssue;
          // Source bin (receive bin): remove the whole putaway amount.
          const putawaySource = {
            module: 'putaway' as const,
            id: putaway.id,
            number: putaway.putawayCode,
          };
          await this.inventory.adjustBinStock(
            inv.id,
            receiveBinId,
            { avail: -putawayTotal },
            { ...putawaySource, note: 'Moved out of the receive bin' },
            tx,
          );
          // Destination bin: good qty + accumulated issues.
          await this.inventory.adjustBinStock(
            inv.id,
            row.binId,
            {
              avail: row.actualQty,
              quality: row.qualityIssue,
              qtyIssue: row.qtyIssue,
            },
            { ...putawaySource, note: 'Put away into the destination bin' },
            tx,
          );
        }
      }

      await tx.putaway.update({
        where: { id },
        data: { status: hasRemaining && !isTransfer ? 'OnProgress' : 'Closed' },
      });
    });

    // Record discrepancies for this GR from the closed putaway(s).
    if ((!hasRemaining || isTransfer) && putaway.goodsReceive?.id) {
      try {
        await this.recordQualityDiscrepancy(putaway.goodsReceive.id);
      } catch (e) {
        this.logger.error(
          `Quality discrepancy recording failed for GR ${putaway.goodsReceive.id}: ${(e as Error).message}`,
        );
      }
      try {
        await this.recordQuantityDiscrepancy(putaway.goodsReceive.id);
      } catch (e) {
        this.logger.error(
          `Quantity discrepancy recording failed for GR ${putaway.goodsReceive.id}: ${(e as Error).message}`,
        );
      }
      // When every putaway of this GR is Closed, close the GR too.
      try {
        await this.maybeCloseGoodsReceive(putaway.goodsReceive.id);
      } catch (e) {
        this.logger.error(
          `GR auto-close failed for ${putaway.goodsReceive.id}: ${(e as Error).message}`,
        );
      }
    }

    const updated = await this.prisma.putaway.findUnique({
      where: { id },
      include: detailInclude,
    });
    return this.serializeDetail(updated!);
  }

  private async recordQualityDiscrepancy(goodsReceiveId: string) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
      include: {
        putaways: {
          where: { status: 'Closed' },
          include: { items: true },
        },
      },
    });
    if (!gr) return;

    const allClosedItems = gr.putaways.flatMap((p) => p.items);
    if (allClosedItems.length === 0) return;

    const totalScrapped = allClosedItems.reduce((s, it) => s + it.qualityIssue, 0);
    if (totalScrapped === 0) return;

    const existing = await this.prisma.discrepancy.findFirst({
      where: { grId: goodsReceiveId, discrepancyType: 'quality' },
    });

    const detailRows = allClosedItems
      .filter((it) => it.qualityIssue > 0)
      .map((it) => ({
        poNumber: it.poNumber ?? '',
        itemName: it.itemName,
        sourceFrom: 'GR' as const,
        qtyDiscrepancy: it.qualityIssue,
        qtyDiscrepancyType: 'shortage' as const,
      }));

    if (existing) {
      await this.prisma.discrepancyDetail.deleteMany({
        where: { discrepancyId: existing.id },
      });
      await this.prisma.discrepancyDetail.createMany({
        data: detailRows.map((r) => ({ ...r, discrepancyId: existing.id })),
      });
      this.logger.log(`Updated quality discrepancy for GR ${gr.sourceDocNumber}`);
    } else {
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
      const discId = `DISC-${today}-${seq}`;

      await this.prisma.discrepancy.create({
        data: {
          discrepancyId: discId,
          grId: goodsReceiveId,
          discrepancyType: 'quality',
          discrepancyFrom: 'inbound',
          warehouseId: gr.warehouseId,
          details: { create: detailRows },
        },
      });
      this.logger.log(`Created quality discrepancy ${discId} for GR ${gr.sourceDocNumber}`);
    }
  }

  // Quantity issues entered during putaway become quantity discrepancy details
  // (source = Putaway) grouped under the GR's quantity discrepancy.
  private async recordQuantityDiscrepancy(goodsReceiveId: string) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
      include: {
        putaways: {
          where: { status: 'Closed' },
          include: { items: true },
        },
      },
    });
    if (!gr) return;

    const issueItems = gr.putaways
      .flatMap((p) => p.items)
      .filter((it) => it.qtyIssue > 0);

    const existing = await this.prisma.discrepancy.findFirst({
      where: { grId: goodsReceiveId, discrepancyType: 'quantity' },
    });

    const detailRows = issueItems.map((it) => ({
      poNumber: it.poNumber ?? '',
      itemName: it.itemName,
      sourceFrom: 'Putaway' as const,
      qtyDiscrepancy: it.qtyIssue,
      qtyDiscrepancyType: 'shortage' as const,
    }));

    if (existing) {
      // Rebuild only the Putaway-source rows; keep GR-source rows intact.
      await this.prisma.discrepancyDetail.deleteMany({
        where: { discrepancyId: existing.id, sourceFrom: 'Putaway' },
      });
      if (detailRows.length > 0) {
        await this.prisma.discrepancyDetail.createMany({
          data: detailRows.map((r) => ({ ...r, discrepancyId: existing.id })),
        });
      }
      this.logger.log(
        `Updated quantity discrepancy (putaway) for GR ${gr.sourceDocNumber}`,
      );
    } else if (detailRows.length > 0) {
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
      const discId = `DISC-${today}-${seq}`;

      await this.prisma.discrepancy.create({
        data: {
          discrepancyId: discId,
          grId: goodsReceiveId,
          discrepancyType: 'quantity',
          discrepancyFrom: 'inbound',
          warehouseId: gr.warehouseId,
          details: { create: detailRows },
        },
      });
      this.logger.log(
        `Created quantity discrepancy ${discId} (putaway) for GR ${gr.sourceDocNumber}`,
      );
    }
  }

  // Close the GR only when BOTH conditions hold:
  //  1) every Putaway document of the GR is Closed, and
  //  2) every GR item has remaining qty = 0 (nothing left to putaway).
  // Otherwise the GR stays On Progress.
  // ---------- Transfer IN stock ----------

  /** The destination warehouse's inventory row of a Transfer IN line (created if missing). */
  private async transferInventory(
    tx: Prisma.TransactionClient,
    grItem: { id: string; materialId: string | null; materialCode: string | null; itemDisplay: string | null },
    warehouseId: string | null,
  ) {
    const materialCode = grItem.materialCode ?? grItem.itemDisplay ?? `ITEM-${grItem.id}`;
    const found = await tx.inventoryManagement.findFirst({
      where: grItem.materialId
        ? { materialId: grItem.materialId, warehouseId }
        : { materialCode, warehouseId },
      select: { id: true },
    });
    return (
      found ??
      (await tx.inventoryManagement.create({
        data: { materialCode, materialId: grItem.materialId, warehouseId },
        select: { id: true },
      }))
    );
  }

  /**
   * Put `qty` of a Transfer IN line into `destBinId` (negative = take it out).
   * GRs received before receive stopped touching stock still hold their qty
   * in the receive bin; that bin gives / takes it back so nothing doubles.
   */
  private async moveTransferStock(
    tx: Prisma.TransactionClient,
    grItemId: string,
    warehouseId: string | null,
    destBinId: string | null,
    qty: number,
    source: { module: 'putaway'; id: string; number: string; note: string },
  ) {
    const grItem = await tx.goodsReceiveItem.findUniqueOrThrow({ where: { id: grItemId } });
    const inv = await this.transferInventory(tx, grItem, warehouseId);
    if (grItem.binId) {
      await this.inventory.adjustBinStock(inv.id, grItem.binId, { avail: -qty }, { ...source, note: `${source.note} (from the receive bin)` }, tx);
    }
    await this.inventory.adjustBinStock(inv.id, destBinId, { avail: qty }, source, tx);
  }

  /**
   * Delete a putaway nothing has been put away on yet. Its planned qty goes
   * back to the GR / MRN line to be generated again; for Transfer IN the stock
   * added to the Destination Bin on generate is taken out again.
   */
  async remove(id: string, scope: WarehouseScope) {
    const pt = await this.prisma.putaway.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!pt || (scope.role !== 'admin' && !inScope(scope, pt.warehouseId))) {
      throw new NotFoundException(`Putaway ${id} not found`);
    }
    const processed = pt.items.some((it) => it.actualQty + it.qualityIssue + it.qtyIssue > 0);
    if (pt.status === 'Closed' || processed) {
      throw new BadRequestException(
        `Putaway ${pt.putawayCode} has already been put away and cannot be deleted`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      for (const it of pt.items) {
        if (it.grItemId) {
          await tx.goodsReceiveItem.update({
            where: { id: it.grItemId },
            data: { qtyRemaining: { increment: it.plannedQty } },
          });
          await this.moveTransferStock(tx, it.grItemId, pt.warehouseId, it.binId, -it.plannedQty, {
            module: 'putaway',
            id: pt.id,
            number: pt.putawayCode,
            note: 'Putaway deleted — stock out of the destination bin',
          });
        } else if (it.mrnItemId) {
          await tx.mrnItem.update({
            where: { id: it.mrnItemId },
            data: { qtyRemaining: { increment: it.plannedQty } },
          });
        }
      }
      await tx.putaway.delete({ where: { id } });
    });
    this.logger.log(`Putaway ${pt.putawayCode} deleted and rolled back`);
    return { deleted: true };
  }

  private async maybeCloseGoodsReceive(goodsReceiveId: string) {
    // Resolve the GR's source MRN (PIB) to count its remaining items.
    const grDoc = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
      select: { sourceType: true, sourceDocId: true },
    });
    const mrnId =
      grDoc?.sourceType === 'PIB' ? grDoc.sourceDocId : '__none__';

    const [total, notClosed, mrnRemaining, grRemaining] = await this.prisma.$transaction([
      this.prisma.putaway.count({ where: { grId: goodsReceiveId } }),
      this.prisma.putaway.count({
        where: { grId: goodsReceiveId, status: { not: 'Closed' } },
      }),
      this.prisma.mrnItem.count({
        where: { mrnId, qtyRemaining: { gt: 0 } },
      }),
      // TO source keeps its remaining on the GR's own lines.
      this.prisma.goodsReceiveItem.count({
        where: { goodsReceiveId, qtyRemaining: { gt: 0 } },
      }),
    ]);
    const itemsWithRemaining = mrnRemaining + grRemaining;

    const allPutawaysClosed = total > 0 && notClosed === 0;
    const allItemsFulfilled = itemsWithRemaining === 0;

    if (allPutawaysClosed && allItemsFulfilled) {
      await this.prisma.goodsReceive.update({
        where: { id: goodsReceiveId },
        data: { status: 'Closed' },
      });
      this.logger.log(
        `GR ${goodsReceiveId} closed — all putaways done and no remaining qty`,
      );
    }
  }

  private serializeList(p: PutawayList) {
    return {
      id: p.id,
      putaway_code: p.putawayCode,
      gr_number: p.goodsReceive?.grNumber ?? null,
      warehouse_name: p.warehouse?.name ?? null,
      status: p.status,
      item_count: p._count.items,
      created_at: p.createdAt,
    };
  }

  private serializeDetail(p: PutawayDetail) {
    return {
      id: p.id,
      putaway_code: p.putawayCode,
      gr_number: p.goodsReceive?.grNumber ?? null,
      warehouse_name: p.warehouse?.name ?? null,
      warehouse_id: p.warehouse?.id ?? null,
      status: p.status,
      created_at: p.createdAt,
      items: p.items.map((it) => ({
        id: it.id,
        mrn_item_id: it.mrnItemId,
        gr_item_id: it.grItemId,
        item_name: it.itemName,
        po_number: it.poNumber,
        material_code: it.materialCode,
        vendor_name: it.vendorName,
        planned_qty: it.plannedQty,
        actual_qty: it.actualQty,
        quality_issue: it.qualityIssue,
        qty_issue: it.qtyIssue,
        remaining_qty: it.remainingQty,
        bin_id: it.binId,
        bin_label: it.bin?.binLabel ?? null,
        qty_remaining: it.mrnItem?.qtyRemaining ?? it.grItem?.qtyRemaining ?? 0,
        picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
      })),
    };
  }
}
