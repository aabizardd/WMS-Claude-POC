import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { BILLING_WAREHOUSE_MARKER } from '../sales-delivery/sales-delivery.service';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';

/**
 * Give the billing warehouses something to return from.
 *
 *   npm run seed:billing-stock
 *
 * A Sales Return is raised FROM a billing warehouse and its quantity is checked
 * against what that warehouse holds — but billing warehouses ship with no stock
 * and no bins at all, so no return could ever be created. This seeds a Virtual
 * bin and a balance for the materials that actually appear on existing Sales
 * Deliveries (those are the ones a return would reverse), falling back to the
 * busiest materials when there are no deliveries yet.
 *
 * Idempotent: re-running tops a material back up to QTY_PER_MATERIAL rather
 * than adding to it.
 */
const QTY_PER_MATERIAL = 100;
/** How many materials to stock when there are no deliveries to learn from. */
const FALLBACK_MATERIALS = 15;

async function run() {
  const logger = new Logger('seed-billing-stock');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  try {
    const billing = await prisma.warehouse.findMany({
      where: {
        isInactive: false,
        subsidiaryId: subsidiarySingleFilter(),
        name: { contains: BILLING_WAREHOUSE_MARKER, mode: 'insensitive' },
      },
      select: { id: true, name: true, oracleId: true },
      orderBy: { name: 'asc' },
    });
    if (!billing.length) {
      throw new Error(
        `No billing warehouse found (name containing "${BILLING_WAREHOUSE_MARKER}")`,
      );
    }
    logger.log(`Billing warehouses: ${billing.length}`);

    // Materials worth stocking: whatever existing deliveries moved.
    const delivered = await prisma.salesDeliveryItem.findMany({
      where: { materialId: { not: null } },
      select: { materialId: true },
      distinct: ['materialId'],
    });
    let materialIds = delivered
      .map((d) => d.materialId)
      .filter((id): id is string => !!id);

    if (materialIds.length < FALLBACK_MATERIALS) {
      const busiest = await prisma.inventoryManagement.findMany({
        where: { materialId: { not: null } },
        select: { materialId: true },
        distinct: ['materialId'],
        take: FALLBACK_MATERIALS,
      });
      materialIds = [
        ...new Set([
          ...materialIds,
          ...busiest.map((b) => b.materialId).filter((id): id is string => !!id),
        ]),
      ];
    }

    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, materialCode: true },
    });
    logger.log(`Materials to stock per warehouse: ${materials.length}`);

    // Master rows a bin needs; billing warehouses have none of their own yet.
    const [areaType, aisle, shelf] = await Promise.all([
      prisma.areaType.findFirst({ where: { areaTypeCode: 'VIRTUAL' }, select: { id: true } }),
      prisma.aisle.findFirst({ where: { aisleCode: 'VIRTUAL' }, select: { id: true } }),
      prisma.shelf.findFirst({ where: { shelfCode: 'VIRTUAL' }, select: { id: true } }),
    ]);
    if (!areaType || !aisle || !shelf) {
      throw new Error('Virtual area/aisle/shelf master rows are missing');
    }

    let bins = 0;
    let rows = 0;

    for (const w of billing) {
      // One Virtual bin per warehouse: stock must never sit without a bin.
      let bin = await prisma.bin.findFirst({
        where: { warehouseId: w.id, isVirtual: true },
        select: { id: true },
      });
      if (!bin) {
        bin = await prisma.bin.create({
          data: {
            binLabel: 'Virtual',
            binCode: `VIRTUAL-BILL-${w.oracleId}`,
            warehouseId: w.id,
            areaTypeId: areaType.id,
            aisleId: aisle.id,
            shelfId: shelf.id,
            isVirtual: true,
            createdBy: 'seed:billing-stock',
          },
          select: { id: true },
        });
        bins++;
      }

      for (const m of materials) {
        if (!m.materialCode) continue;
        const inv = await prisma.inventoryManagement.upsert({
          where: {
            materialCode_warehouseId: {
              materialCode: m.materialCode,
              warehouseId: w.id,
            },
          },
          update: { materialId: m.id },
          create: {
            materialCode: m.materialCode,
            materialId: m.id,
            warehouseId: w.id,
          },
          select: { id: true },
        });
        // Set (not add) so a re-run tops up to the same balance.
        await prisma.inventoryBinStock.upsert({
          where: { inventoryId_binId: { inventoryId: inv.id, binId: bin.id } },
          update: { availQty: QTY_PER_MATERIAL },
          create: {
            inventoryId: inv.id,
            binId: bin.id,
            availQty: QTY_PER_MATERIAL,
          },
        });
        rows++;
      }
    }

    logger.log(
      `Done: ${bins} Virtual bin(s) created, ${rows} material balance(s) set to ${QTY_PER_MATERIAL}.`,
    );
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
