import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GeneratePutawayDto } from './dto/generate-putaway.dto';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
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
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      history?: string | boolean;
    },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;

    const where: Prisma.PutawayWhereInput = { ...this.scopeWhere(scope) };
    // History tab = Closed only; Putaway tab = active (Open / OnProgress).
    const isHistory = query.history === true || query.history === 'true';
    where.status = isHistory ? 'Closed' : { not: 'Closed' };
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
    const pt = await this.prisma.putaway.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !pt ||
      (scope.role !== 'admin' && pt.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Putaway ${id} not found`);
    }
    return this.serializeDetail(pt);
  }

  async generate(dto: GeneratePutawayDto) {
    let goodsReceiveId: string | null = null;
    let warehouseId: string | null = null;
    const itemRows: {
      mrnItemId: string;
      plannedQty: number;
      pickerId: number | null;
      itemName: string | null;
      poNumber: string | null;
      vendorName: string | null;
      materialCode: string | null;
    }[] = [];

    for (const row of dto.items) {
      const mrnItem = await this.prisma.mrnItem.findUnique({
        where: { id: row.mrnItemId },
        include: {
          mrn: {
            include: {
              goodsReceive: { select: { id: true, warehouseId: true } },
            },
          },
        },
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
      const grRef = mrnItem.mrn.goodsReceive;
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
        plannedQty: row.plannedQty,
        pickerId: row.pickerId ?? null,
        itemName: mrnItem.itemName,
        poNumber: mrnItem.poNumber,
        vendorName: mrnItem.vendorName,
        materialCode,
      });
    }

    if (itemRows.length === 0) {
      throw new BadRequestException('No valid items to putaway');
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
              itemName: it.itemName,
              poNumber: it.poNumber,
              materialCode: it.materialCode,
              vendorName: it.vendorName,
              plannedQty: it.plannedQty,
              pickerId: it.pickerId,
            })),
          },
        },
        include: detailInclude,
      });

      for (const it of itemRows) {
        await tx.mrnItem.update({
          where: { id: it.mrnItemId },
          data: { qtyRemaining: { decrement: it.plannedQty } },
        });
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
      include: { items: { include: { mrnItem: true } }, goodsReceive: true },
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
            binId: row.binId,
          },
        });

        // Add back unused qty to mrn_item remaining
        if (remaining > 0) {
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
        const inv = await tx.inventoryManagement.findFirst({
          where: { materialCode, warehouseId: putaway.warehouseId },
          select: { id: true },
        });
        if (inv) {
          const putawayTotal = row.actualQty + row.qualityIssue + row.qtyIssue;
          // Source bin (receive bin): remove the whole putaway amount.
          await this.inventory.adjustBinStock(
            inv.id,
            mrnItem.binId ?? null,
            { avail: -putawayTotal },
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
            tx,
          );
        }
      }

      await tx.putaway.update({
        where: { id },
        data: { status: hasRemaining ? 'OnProgress' : 'Closed' },
      });
    });

    // Record discrepancies for this GR from the closed putaway(s).
    if (!hasRemaining && putaway.goodsReceive?.id) {
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
        mrn: { include: { items: true } },
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
      this.logger.log(`Updated quality discrepancy for GR ${gr.mrn.shipmentNumber}`);
    } else {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await this.prisma.discrepancy.count({
        where: { discrepancyId: { startsWith: `DISC-${today}` } },
      });
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
      this.logger.log(`Created quality discrepancy ${discId} for GR ${gr.mrn.shipmentNumber}`);
    }
  }

  // Quantity issues entered during putaway become quantity discrepancy details
  // (source = Putaway) grouped under the GR's quantity discrepancy.
  private async recordQuantityDiscrepancy(goodsReceiveId: string) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
      include: {
        mrn: { include: { items: true } },
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
        `Updated quantity discrepancy (putaway) for GR ${gr.mrn.shipmentNumber}`,
      );
    } else if (detailRows.length > 0) {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await this.prisma.discrepancy.count({
        where: { discrepancyId: { startsWith: `DISC-${today}` } },
      });
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
        `Created quantity discrepancy ${discId} (putaway) for GR ${gr.mrn.shipmentNumber}`,
      );
    }
  }

  // Close the GR only when BOTH conditions hold:
  //  1) every Putaway document of the GR is Closed, and
  //  2) every GR item has remaining qty = 0 (nothing left to putaway).
  // Otherwise the GR stays On Progress.
  private async maybeCloseGoodsReceive(goodsReceiveId: string) {
    const [total, notClosed, itemsWithRemaining] = await this.prisma.$transaction([
      this.prisma.putaway.count({ where: { grId: goodsReceiveId } }),
      this.prisma.putaway.count({
        where: { grId: goodsReceiveId, status: { not: 'Closed' } },
      }),
      this.prisma.mrnItem.count({
        where: {
          mrn: { goodsReceive: { id: goodsReceiveId } },
          qtyRemaining: { gt: 0 },
        },
      }),
    ]);

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
        qty_remaining: it.mrnItem.qtyRemaining,
        picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
      })),
    };
  }
}
