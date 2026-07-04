import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Seed inventory + bins to test the Outbound picking flow for two materials.
 * Stock is placed in the warehouse(s) of Pending Fulfillment Sales Orders that
 * contain these materials (so the bin-source dropdown shows options); falls back
 * to the first warehouse. Idempotent — safe to run repeatedly.
 *
 * NOTE: material codes in this system include the name suffix.
 *
 *   npm run seed:outbound-test
 */
const MATERIALS = [
  { code: '1020900100 - REVERSE ALARM' },
  { code: '1020900113 - EMERGENCY STOP' },
];

// Bare codes accidentally created by an earlier version of this script.
const STALE_BARE_CODES = ['1020900100', '1020900113'];

// availQty seeded per bin, per material.
const BINS = [
  { suffix: 'A', avail: 100 },
  { suffix: 'B', avail: 50 },
];

async function run() {
  const logger = new Logger('seed-outbound-test');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  try {
    // 0) Clean up data created by the earlier (buggy) seed:
    //    - stale inventory rows keyed by bare material codes (+ their bin stocks)
    //    - the TST- test bins
    //    - spurious materials with bare codes and no erp_doc_id
    const staleInvs = await prisma.inventoryManagement.findMany({
      where: { materialCode: { in: STALE_BARE_CODES } },
      select: { id: true },
    });
    if (staleInvs.length) {
      await prisma.inventoryManagement.deleteMany({
        where: { id: { in: staleInvs.map((i) => i.id) } },
      }); // cascades inventory_bin_stocks
    }
    const tstBins = await prisma.bin.findMany({
      where: { binCode: { startsWith: 'TST-' } },
      select: { id: true },
    });
    if (tstBins.length) {
      await prisma.inventoryBinStock.deleteMany({
        where: { binId: { in: tstBins.map((b) => b.id) } },
      });
      await prisma.bin.deleteMany({
        where: { id: { in: tstBins.map((b) => b.id) } },
      });
    }
    await prisma.material.deleteMany({
      where: { materialCode: { in: STALE_BARE_CODES }, erpDocId: null },
    });
    logger.log(
      `Cleanup: removed ${staleInvs.length} stale inventory, ${tstBins.length} TST bin(s).`,
    );

    const codes = MATERIALS.map((m) => m.code);

    // 1) Materials must already exist (from ERP sync). Resolve by code.
    const materialByCode = new Map<string, { id: string }>();
    for (const m of MATERIALS) {
      const mat = await prisma.material.findUnique({
        where: { materialCode: m.code },
        select: { id: true },
      });
      if (!mat) {
        logger.warn(`Material "${m.code}" not found — skipping.`);
        continue;
      }
      materialByCode.set(m.code, mat);
    }
    if (materialByCode.size === 0) {
      throw new Error('None of the target materials exist. Sync materials first.');
    }

    // 2) Target warehouses: those of Pending Fulfillment SOs containing these
    //    materials; fallback to the first warehouse.
    const soItems = await prisma.salesOrderItem.findMany({
      where: {
        material: { materialCode: { in: codes } },
        salesOrder: { statusName: 'Pending Fulfillment' },
      },
      select: { salesOrder: { select: { warehouseId: true } } },
    });
    let warehouseIds = [
      ...new Set(
        soItems
          .map((s) => s.salesOrder.warehouseId)
          .filter((w): w is string => !!w),
      ),
    ];
    if (warehouseIds.length === 0) {
      const first = await prisma.warehouse.findFirst({ select: { id: true } });
      if (!first) throw new Error('No warehouse found — seed warehouses first.');
      warehouseIds = [first.id];
      logger.warn(
        `No matching Sales Order found; using first warehouse ${first.id}`,
      );
    }
    logger.log(`Target warehouse(s): ${warehouseIds.join(', ')}`);

    // 3) Master refs required by Bin (reuse existing, else create one).
    const areaType =
      (await prisma.areaType.findFirst({ select: { id: true } })) ??
      (await prisma.areaType.create({
        data: { areaTypeName: 'Test Area', areaTypeCode: 'TSTAREA' },
        select: { id: true },
      }));
    const aisle =
      (await prisma.aisle.findFirst({ select: { id: true } })) ??
      (await prisma.aisle.create({
        data: { aisleName: 'Test Aisle', aisleCode: 'TSTAISLE' },
        select: { id: true },
      }));
    const shelf =
      (await prisma.shelf.findFirst({ select: { id: true } })) ??
      (await prisma.shelf.create({
        data: { shelfLabel: 'Test Shelf', shelfCode: 'TSTSHELF' },
        select: { id: true },
      }));

    // 4) Bins + inventory + per-bin stock for each warehouse & material.
    for (const warehouseId of warehouseIds) {
      const whTag = warehouseId.slice(0, 8);
      for (const b of BINS) {
        const binCode = `TST-${whTag}-${b.suffix}`;
        const bin = await prisma.bin.upsert({
          where: { binCode },
          update: {},
          create: {
            binLabel: `Test Bin ${b.suffix}`,
            binCode,
            warehouseId,
            aisleId: aisle.id,
            shelfId: shelf.id,
            areaTypeId: areaType.id,
            createdBy: 'outbound-test',
          },
          select: { id: true },
        });

        for (const [code, mat] of materialByCode) {
          let inv = await prisma.inventoryManagement.findFirst({
            where: { materialCode: code, warehouseId },
            select: { id: true },
          });
          if (!inv) {
            inv = await prisma.inventoryManagement.create({
              data: { materialCode: code, materialId: mat.id, warehouseId },
              select: { id: true },
            });
          }
          await prisma.inventoryBinStock.upsert({
            where: {
              inventoryId_binId: { inventoryId: inv.id, binId: bin.id },
            },
            update: { availQty: b.avail },
            create: { inventoryId: inv.id, binId: bin.id, availQty: b.avail },
          });
        }
        logger.log(`Bin ${binCode} stocked (avail ${b.avail} each material).`);
      }
    }

    logger.log(
      `Done. Warehouses: ${warehouseIds.length}, materials: ${materialByCode.size}.`,
    );
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
