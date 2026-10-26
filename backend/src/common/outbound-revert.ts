import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InventoryService, StockMovementSource } from '../inventory/inventory.service';

/*
 * Undoing an outbound step. Closing a Picking or a Packing moves the qty that
 * could not be handled (qty issue + quality issue) out of Reserved into the
 * bin's issue buckets and records discrepancies. Re-opening the document
 * reverses exactly that: issue buckets → Reserved, discrepancies removed, and
 * the lines' progress reset so the work is done again from scratch.
 */

const EPS = 1e-9;

interface IssueLine {
  materialCode: string | null;
  materialName: string | null;
  binId: string | null;
  qtyIssue: number;
  qualityIssue: number;
}

/** Move each line's issue qty back into Reserved in its bin. */
async function returnIssueToReserved(
  tx: Prisma.TransactionClient,
  inventory: InventoryService,
  warehouseId: string | null,
  lines: IssueLine[],
  source: StockMovementSource,
) {
  for (const it of lines) {
    if (!it.materialCode) continue;
    const gap = it.qtyIssue + it.qualityIssue;
    if (gap <= EPS) continue;
    const inv = await tx.inventoryManagement.findFirst({
      where: { materialCode: it.materialCode, warehouseId },
      select: { id: true },
    });
    if (!inv) continue;
    // The issue stock may have been adjusted away since; never drive it negative.
    const bin = await tx.inventoryBinStock.findFirst({
      where: { inventoryId: inv.id, binId: it.binId },
      select: { qtyIssue: true, qualityIssue: true },
    });
    if (!bin || bin.qtyIssue + EPS < it.qtyIssue || bin.qualityIssue + EPS < it.qualityIssue) {
      throw new BadRequestException(
        `Cannot reopen ${source.number}: the issue stock of "${it.materialName ?? it.materialCode}" has already been adjusted`,
      );
    }
    await inventory.adjustBinStock(
      inv.id,
      it.binId,
      { reserved: gap, qtyIssue: -it.qtyIssue, quality: -it.qualityIssue },
      source,
      tx,
    );
  }
}

/**
 * Remove the discrepancies a Picking / Packing recorded on close. Refused when
 * one has already been settled by an Inventory Adjustment.
 */
async function dropDiscrepancies(
  tx: Prisma.TransactionClient,
  pickingId: string,
  sourceFrom: 'Picking' | 'Packing',
  docNumber: string,
) {
  const rows = await tx.discrepancy.findMany({
    where: { pickingId, details: { some: { sourceFrom } } },
    select: { id: true, discrepancyId: true, _count: { select: { adjustmentLinks: true } } },
  });
  const used = rows.find((r) => r._count.adjustmentLinks > 0);
  if (used) {
    throw new BadRequestException(
      `Cannot reopen ${docNumber}: discrepancy ${used.discrepancyId} is already linked to an Inventory Adjustment`,
    );
  }
  if (rows.length) {
    await tx.discrepancy.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  }
}

/** Packing → Open: undo its close (if closed) and clear its progress. */
export async function reopenPacking(
  tx: Prisma.TransactionClient,
  inventory: InventoryService,
  packingId: string,
  actorId: number | undefined,
  note: string,
) {
  const pk = await tx.packing.findUniqueOrThrow({
    where: { id: packingId },
    include: { items: true },
  });
  if (pk.status === 'Closed') {
    await returnIssueToReserved(tx, inventory, pk.warehouseId, pk.items, {
      module: 'packing',
      id: pk.id,
      number: pk.packingCode,
      actorId,
      note,
    });
    await dropDiscrepancies(tx, pk.pickingId, 'Packing', pk.packingCode);
  }
  for (const it of pk.items) {
    await tx.packingItem.update({
      where: { id: it.id },
      data: { actualQty: 0, qtyIssue: 0, qualityIssue: 0, remainingQty: it.qty },
    });
  }
  await tx.packing.update({ where: { id: pk.id }, data: { status: 'Open' } });
}

/** Picking → Open: undo its close (if closed) and clear its progress. */
export async function reopenPicking(
  tx: Prisma.TransactionClient,
  inventory: InventoryService,
  pickingId: string,
  actorId: number | undefined,
  note: string,
) {
  const pk = await tx.picking.findUniqueOrThrow({
    where: { id: pickingId },
    include: { items: true },
  });
  if (pk.status === 'Closed') {
    await returnIssueToReserved(tx, inventory, pk.warehouseId, pk.items, {
      module: 'picking',
      id: pk.id,
      number: pk.pickingCode,
      actorId,
      note,
    });
    await dropDiscrepancies(tx, pk.id, 'Picking', pk.pickingCode);
  }
  for (const it of pk.items) {
    await tx.pickingItem.update({
      where: { id: it.id },
      data: {
        actualQty: 0,
        qtyIssue: 0,
        qualityIssue: 0,
        remainingQty: it.requestQty,
        status: 'Open',
      },
    });
  }
  await tx.picking.update({
    where: { id: pk.id },
    data: { status: 'Open', packingId: null },
  });
}
