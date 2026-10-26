import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';

/**
 * Build one Delivery Plan that covers SEVERAL packings and prints over more
 * than one page.
 *
 *   npm run seed:multi-packing-delivery
 *
 * It picks a Sales Order with lines, creates a Picking + several Packings from
 * them, then one Delivery whose items carry their own Packing ID — which is
 * what the print-out shows per line. Enough lines are produced to spill onto a
 * second page.
 *
 * Idempotent: an earlier run's documents (same code prefix) are removed first.
 */
/** Lines per packing, and how many packings to build. */
const PACKINGS = 3;
const LINES_PER_PACKING = 16;
const CODE_TAG = 'MPD'; // marks the documents this script owns

async function run() {
  const logger = new Logger('seed-multi-packing-delivery');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  try {
    // --- clean up a previous run -------------------------------------------
    const old = await prisma.delivery.findMany({
      where: { deliveryCode: { contains: CODE_TAG } },
      select: { id: true, packingId: true },
    });
    if (old.length) {
      await prisma.delivery.deleteMany({
        where: { id: { in: old.map((d) => d.id) } },
      });
    }
    await prisma.packing.deleteMany({ where: { packingCode: { contains: CODE_TAG } } });
    await prisma.picking.deleteMany({ where: { pickingCode: { contains: CODE_TAG } } });
    if (old.length) logger.log(`Removed ${old.length} document set(s) from an earlier run.`);

    // --- the source Sales Order --------------------------------------------
    const so = await prisma.salesOrder.findFirst({
      where: {
        subsidiaryId: subsidiarySingleFilter(),
        warehouseId: { not: null },
        items: { some: {} },
      },
      include: {
        items: {
          include: {
            material: { select: { id: true, materialCode: true, materialName: true } },
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!so?.warehouseId) {
      throw new Error('No Sales Order with items and a warehouse was found');
    }

    const user = await prisma.user.findFirst({ select: { id: true } });

    // Bins of that warehouse, to spread the lines over (staging + picked from).
    // Real staging/picking bins only: never the Virtual one, never a frozen
    // (KIT) bin — stock there cannot be picked.
    const bins = await prisma.bin.findMany({
      where: {
        warehouseId: so.warehouseId,
        isActive: true,
        isVirtual: false,
        NOT: { binLabel: { contains: 'KIT', mode: 'insensitive' } },
      },
      select: { id: true, binLabel: true },
      orderBy: { binCode: 'asc' },
    });
    if (!bins.length) throw new Error('The order\'s warehouse has no bins');

    // Materials: reuse the order's own lines, topped up from the catalogue so
    // there are enough rows to run past one page.
    const needed = PACKINGS * LINES_PER_PACKING;
    const fromOrder = so.items.filter((i) => i.materialId);
    const extra = await prisma.material.findMany({
      where: { id: { notIn: fromOrder.map((i) => i.materialId!) } },
      select: { id: true, materialCode: true, materialName: true },
      take: Math.max(0, needed - fromOrder.length),
    });
    const lines = [
      ...fromOrder.map((i) => ({
        salesOrderItemId: i.id,
        materialId: i.materialId!,
        materialCode: i.material?.materialCode ?? i.itemName,
        materialName: i.material?.materialName ?? i.itemName,
      })),
      ...extra.map((m) => ({
        salesOrderItemId: null as string | null,
        materialId: m.id,
        materialCode: m.materialCode,
        materialName: m.materialName,
      })),
    ].slice(0, needed);
    if (lines.length < needed) {
      logger.warn(`Only ${lines.length} material(s) available; wanted ${needed}.`);
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // --- several packings, each from its own picking -----------------------
    // Packing.pickingId is unique: one picking becomes exactly one packing, so
    // a delivery covering three packings comes from three pickings of the same
    // Sales Order — which is how the real flow behaves too.
    const packingIds: { id: string; code: string }[] = [];
    for (let p = 0; p < PACKINGS; p++) {
      const slice = lines.slice(p * LINES_PER_PACKING, (p + 1) * LINES_PER_PACKING);
      if (!slice.length) break;

      const picking = await prisma.picking.create({
        data: {
          pickingCode: `PICK-${today}-${CODE_TAG}${p + 1}`,
          sourceType: 'SALES_ORDER',
          salesOrderId: so.id,
          warehouseId: so.warehouseId,
          status: 'Closed',
        },
        select: { id: true },
      });

      // One picking line per packed line, so each delivery line can report the
      // bin it was actually picked from.
      const pickingItems = await Promise.all(
        slice.map((l, i) =>
          prisma.pickingItem.create({
            data: {
              pickingId: picking.id,
              salesOrderItemId: l.salesOrderItemId,
              materialId: l.materialId,
              materialCode: l.materialCode,
              materialName: l.materialName,
              requestQty: 5 + i,
              actualQty: 5 + i,
              remainingQty: 0,
              // Picked from one bin, staged in another — as in the real flow.
              binId: bins[(p + i) % bins.length].id,
              pickerId: user?.id ?? null,
            },
            select: { id: true },
          }),
        ),
      );

      const code = `PACK-${today}-${CODE_TAG}${p + 1}`;
      const packing = await prisma.packing.create({
        data: {
          packingCode: code,
          sourceType: 'SALES_ORDER',
          pickingId: picking.id,
          warehouseId: so.warehouseId,
          status: 'Closed',
          items: {
            create: slice.map((l, i) => ({
              salesOrderItemId: l.salesOrderItemId,
              materialId: l.materialId,
              materialCode: l.materialCode,
              materialName: l.materialName,
              qty: 5 + i,
              actualQty: 5 + i,
              remainingQty: 0,
              // Staging bin: a different bin from the one it was picked from.
              binId: bins[(p + i + 1) % bins.length].id,
              pickingItemId: pickingItems[i].id,
              pickerId: user?.id ?? null,
            })),
          },
        },
        select: { id: true, packingCode: true, items: true },
      });
      packingIds.push({ id: packing.id, code: packing.packingCode });
    }

    // --- one delivery covering them all ------------------------------------
    const allItems = await prisma.packingItem.findMany({
      where: { packingId: { in: packingIds.map((p) => p.id) } },
      orderBy: { createdAt: 'asc' },
    });

    const delivery = await prisma.delivery.create({
      data: {
        deliveryCode: `DEL-${today}-${CODE_TAG}`,
        sourceType: 'SALES_ORDER',
        // The first packing stays the document's primary reference.
        packingId: packingIds[0].id,
        warehouseId: so.warehouseId,
        status: 'Open',
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
        items: {
          create: allItems.map((it) => ({
            salesOrderItemId: it.salesOrderItemId,
            materialId: it.materialId,
            materialCode: it.materialCode,
            materialName: it.materialName,
            qty: it.actualQty,
            binId: it.binId,
            // The picking line, so the document can show its Picking Bin.
            pickingItemId: it.pickingItemId,
            pickerId: it.pickerId,
            // What the print-out shows per line.
            packingId: it.packingId,
          })),
        },
      },
      select: { id: true, deliveryCode: true, _count: { select: { items: true } } },
    });

    logger.log(
      `Done: ${delivery.deliveryCode} — ${delivery._count.items} line(s) across ` +
        `${packingIds.length} packing(s): ${packingIds.map((p) => p.code).join(', ')}`,
    );
    logger.log(`Print it at /admin/outbound/sales-order/delivery/${delivery.id}/print`);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
