import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Spread inventory across a realistic mix of bins instead of the single
 * "Virtual" bin every warehouse starts with.
 *
 *   npm run seed:bin-variety
 *
 * Rules this script keeps:
 *  - Quantities are REDISTRIBUTED, never invented: the per-material totals of
 *    avail / reserved / in-transit / quality issue / qty issue are identical
 *    before and after a run.
 *  - Every stock row ends up on a real bin — no bin_id is left null.
 *  - A material with nothing on hand still gets one row, on the Virtual bin.
 *  - Deterministic and idempotent: the layout is derived from the inventory id,
 *    so re-running produces exactly the same result (it collapses to the totals
 *    first, then lays them out again).
 *
 * Physical bins reuse the existing aisle / shelf / area-type master rows; only
 * Bin rows are created, with codes prefixed per warehouse so they stay unique.
 */

// The physical bins created in every warehouse, on top of its Virtual bin.
// `area` picks which existing AreaType / Aisle / Shelf the bin is filed under.
const BIN_TEMPLATES = [
  { suffix: 'STG-A1-01', label: 'Storage A1-01', area: 'storage' },
  { suffix: 'STG-A1-02', label: 'Storage A1-02', area: 'storage' },
  { suffix: 'STG-A1-03', label: 'Storage A1-03', area: 'storage' },
  { suffix: 'STG-A1-04', label: 'Storage A1-04', area: 'storage' },
  { suffix: 'STG-A2-01', label: 'Storage A2-01', area: 'storage' },
  { suffix: 'STG-A2-02', label: 'Storage A2-02', area: 'storage' },
  { suffix: 'STG-A2-03', label: 'Storage A2-03', area: 'storage' },
  { suffix: 'STG-A2-04', label: 'Storage A2-04', area: 'storage' },
  { suffix: 'RCV-I1-01', label: 'Receiving I1-01', area: 'stock_in' },
  { suffix: 'RCV-I1-02', label: 'Receiving I1-02', area: 'stock_in' },
  { suffix: 'SHP-O1-01', label: 'Shipping O1-01', area: 'stock_out' },
  { suffix: 'SHP-O1-02', label: 'Shipping O1-02', area: 'stock_out' },
  { suffix: 'DSC-D1-01', label: 'Discrepancy D1-01', area: 'discrepancy' },
  // "KIT" in the label marks frozen stock: reported as Freeze Qty, never
  // offered as a source for picking, adjustment or transfer.
  { suffix: 'KIT-A1-01', label: 'KIT A1-01', area: 'storage' },
  { suffix: 'KIT-A1-02', label: 'KIT A1-02', area: 'storage' },
] as const;

/**
 * A material holding at least this much available stock is spread over every
 * physical bin, which puts it past the 10-bin mark the list uses to send the
 * user to the detail page. Below it, the layout stays narrow (1-3 bins) so the
 * data keeps a realistic mix.
 */
const WIDE_SPREAD_MIN_QTY = 100;

/**
 * A material holding at least this much available stock also parks some of it
 * in the KIT bins, so Freeze Qty is exercised by the data.
 */
const FROZEN_MIN_QTY = 50;

type AreaKey = (typeof BIN_TEMPLATES)[number]['area'];

// Which master row each area key should use, matched on the code already seeded.
const AREA_MASTER: Record<
  AreaKey,
  { areaCode: string; aisleCode: string; shelfCode: string }
> = {
  storage: {
    areaCode: 'STORAGEAREA',
    aisleCode: 'IELJKTSA1',
    shelfCode: 'IELJKTSA1S1',
  },
  stock_in: {
    areaCode: 'STOCKINAREA',
    aisleCode: 'IELJKTIA1',
    shelfCode: 'IELJKTIA1S1',
  },
  stock_out: {
    areaCode: 'STOCKOUTAREA',
    aisleCode: 'IELJKTOA1',
    shelfCode: 'IELJKTOA1S1',
  },
  discrepancy: {
    areaCode: 'DISCREPANCYAREA',
    aisleCode: 'IELJKTDA1',
    shelfCode: 'IELJKTDA1S1',
  },
};

interface Totals {
  avail: number;
  reserved: number;
  inTransit: number;
  quality: number;
  qtyIssue: number;
}

/** Stable small hash of a string, so a run is reproducible. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Split `total` into `parts` whole numbers that sum back to `total`.
 * The weights decide the shape; the first part absorbs the rounding remainder,
 * which is what keeps the sum exact.
 */
function splitWhole(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sumW <= 0) return weights.map(() => 0);

  // Decimal stock (fractional UoM) is left on a single bin rather than being
  // chopped into values the UoM may not allow.
  if (!Number.isInteger(total)) {
    return weights.map((_, i) => (i === 0 ? total : 0));
  }

  const parts = weights.map((w) => Math.floor((total * w) / sumW));
  parts[0] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

async function run() {
  const logger = new Logger('seed-bin-variety');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  try {
    // 1) Master rows every physical bin needs. They are global (not per
    //    warehouse) in this database, so one lookup serves every warehouse.
    const [areaTypes, aisles, shelves] = await Promise.all([
      prisma.areaType.findMany({ select: { id: true, areaTypeCode: true } }),
      prisma.aisle.findMany({ select: { id: true, aisleCode: true } }),
      prisma.shelf.findMany({ select: { id: true, shelfCode: true } }),
    ]);
    const areaByCode = new Map(areaTypes.map((a) => [a.areaTypeCode, a.id]));
    const aisleByCode = new Map(aisles.map((a) => [a.aisleCode, a.id]));
    const shelfByCode = new Map(shelves.map((s) => [s.shelfCode, s.id]));

    const resolveMaster = (area: AreaKey) => {
      const m = AREA_MASTER[area];
      const areaTypeId = areaByCode.get(m.areaCode);
      const aisleId = aisleByCode.get(m.aisleCode);
      const shelfId = shelfByCode.get(m.shelfCode);
      if (!areaTypeId || !aisleId || !shelfId) {
        throw new Error(
          `Master data missing for "${area}" (area ${m.areaCode}, aisle ${m.aisleCode}, shelf ${m.shelfCode}). Seed master data first.`,
        );
      }
      return { areaTypeId, aisleId, shelfId };
    };

    // 2) Only warehouses that actually hold inventory get new bins.
    const invWarehouses = await prisma.inventoryManagement.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { not: null } },
      _count: { _all: true },
    });
    const warehouseIds = invWarehouses
      .map((w) => w.warehouseId)
      .filter((id): id is string => !!id);
    const warehouses = await prisma.warehouse.findMany({
      where: { id: { in: warehouseIds } },
      select: { id: true, name: true, oracleId: true },
    });
    logger.log(`Warehouses holding inventory: ${warehouses.length}`);

    // 3) Ensure the Virtual bin + the physical bins exist in each of them.
    const binsByWarehouse = new Map<
      string,
      {
        virtualId: string;
        physical: { id: string; area: AreaKey; frozen: boolean }[];
      }
    >();

    for (const w of warehouses) {
      let virtual = await prisma.bin.findFirst({
        where: { warehouseId: w.id, isVirtual: true },
        select: { id: true },
      });
      if (!virtual) {
        const m = resolveMaster('storage');
        virtual = await prisma.bin.create({
          data: {
            binLabel: 'Virtual',
            binCode: `VIRTUAL-${w.oracleId}`,
            warehouseId: w.id,
            ...m,
            isVirtual: true,
            createdBy: 'seed:bin-variety',
          },
          select: { id: true },
        });
        logger.warn(`Created the missing Virtual bin for ${w.name}`);
      }

      const physical: { id: string; area: AreaKey; frozen: boolean }[] = [];
      for (const t of BIN_TEMPLATES) {
        const binCode = `WH${w.oracleId}-${t.suffix}`;
        const m = resolveMaster(t.area);
        // Upsert on the unique code, so re-running never duplicates a bin.
        const bin = await prisma.bin.upsert({
          where: { binCode },
          update: { binLabel: t.label, warehouseId: w.id, isActive: true, ...m },
          create: {
            binLabel: t.label,
            binCode,
            binLength: 100,
            binWidth: 80,
            binHeight: 60,
            maxCapacity: 1000,
            warehouseId: w.id,
            ...m,
            isVirtual: false,
            createdBy: 'seed:bin-variety',
          },
          select: { id: true },
        });
        physical.push({
          id: bin.id,
          area: t.area,
          frozen: t.label.toUpperCase().includes('KIT'),
        });
      }
      binsByWarehouse.set(w.id, { virtualId: virtual.id, physical });
    }
    logger.log(
      `Bins ready: ${BIN_TEMPLATES.length} physical + 1 virtual per warehouse.`,
    );

    // 4) Lay every inventory row out over those bins.
    const inventories = await prisma.inventoryManagement.findMany({
      where: { warehouseId: { in: warehouseIds } },
      select: {
        id: true,
        materialCode: true,
        warehouseId: true,
        binStocks: {
          select: {
            reservedQty: true,
            availQty: true,
            inTransitQty: true,
            qualityIssue: true,
            qtyIssue: true,
          },
        },
      },
    });

    let touched = 0;
    let emptyRows = 0;
    let rowsWritten = 0;

    for (const inv of inventories) {
      const bins = binsByWarehouse.get(inv.warehouseId!);
      if (!bins) continue;

      // Collapse to totals first — this is what makes a re-run a no-op.
      const t: Totals = inv.binStocks.reduce(
        (a, b) => ({
          avail: a.avail + b.availQty,
          reserved: a.reserved + b.reservedQty,
          inTransit: a.inTransit + b.inTransitQty,
          quality: a.quality + b.qualityIssue,
          qtyIssue: a.qtyIssue + b.qtyIssue,
        }),
        { avail: 0, reserved: 0, inTransit: 0, quality: 0, qtyIssue: 0 },
      );

      const h = hash(inv.id);
      const storage = bins.physical.filter(
        (b) => b.area === 'storage' && !b.frozen,
      );
      const frozen = bins.physical.filter((b) => b.frozen);
      const stockIns = bins.physical.filter((b) => b.area === 'stock_in');
      const stockOuts = bins.physical.filter((b) => b.area === 'stock_out');
      const stockIn = stockIns[0];
      const discrepancy = bins.physical.find((b) => b.area === 'discrepancy')!;

      // A well-stocked material occupies the whole rack; a small one sits in a
      // couple of bins. Both keep their totals — only the layout differs.
      const wide = t.avail >= WIDE_SPREAD_MIN_QTY;
      // Enough stock to justify holding a kitting reserve as well.
      const freezes = t.avail >= FROZEN_MIN_QTY ? frozen : [];
      const picked = wide
        ? [...storage, ...stockIns, ...stockOuts, ...freezes]
        : (() => {
            const narrow = [...storage.slice(0, 1 + (h % 3))];
            // Roughly a third also sit in receiving, a quarter in shipping.
            if (h % 3 === 0) narrow.push(stockIn);
            if (h % 4 === 0) narrow.push(stockOuts[0]);
            // Every third of the smaller materials still keeps a kitting slice.
            if (freezes.length && h % 3 === 1) narrow.push(freezes[0]);
            return narrow;
          })();

      // Available: spread over the picked bins, with a slice left on Virtual for
      // the wide ones and about half the rest, so Virtual keeps showing up.
      const keepVirtual = wide || h % 2 === 0;
      const availTargets = keepVirtual
        ? [...picked.map((b) => b.id), bins.virtualId]
        : picked.map((b) => b.id);
      const availWeights = availTargets.map((_, i) => (i === 0 ? 5 : 3));
      const availParts = splitWhole(t.avail, availWeights);

      const perBin = new Map<
        string,
        { avail: number; reserved: number; inTransit: number; quality: number; qtyIssue: number }
      >();
      const bump = (
        binId: string,
        patch: Partial<{
          avail: number;
          reserved: number;
          inTransit: number;
          quality: number;
          qtyIssue: number;
        }>,
      ) => {
        const cur =
          perBin.get(binId) ??
          { avail: 0, reserved: 0, inTransit: 0, quality: 0, qtyIssue: 0 };
        perBin.set(binId, {
          avail: cur.avail + (patch.avail ?? 0),
          reserved: cur.reserved + (patch.reserved ?? 0),
          inTransit: cur.inTransit + (patch.inTransit ?? 0),
          quality: cur.quality + (patch.quality ?? 0),
          qtyIssue: cur.qtyIssue + (patch.qtyIssue ?? 0),
        });
      };

      availTargets.forEach((binId, i) => bump(binId, { avail: availParts[i] }));
      // Reserved and in-transit ride along with the first storage bin; the two
      // issue buckets belong in the discrepancy bin, which is where a warehouse
      // would physically park them.
      if (t.reserved) bump(picked[0].id, { reserved: t.reserved });
      if (t.inTransit) bump(stockIn.id, { inTransit: t.inTransit });
      if (t.quality) bump(discrepancy.id, { quality: t.quality });
      if (t.qtyIssue) bump(discrepancy.id, { qtyIssue: t.qtyIssue });

      // Drop bins that ended up holding nothing, so the list stays readable.
      let rows = [...perBin.entries()].filter(
        ([, q]) =>
          q.avail !== 0 ||
          q.reserved !== 0 ||
          q.inTransit !== 0 ||
          q.quality !== 0 ||
          q.qtyIssue !== 0,
      );

      // A material with nothing on hand still gets one row, on Virtual.
      if (rows.length === 0) {
        rows = [
          [
            bins.virtualId,
            { avail: 0, reserved: 0, inTransit: 0, quality: 0, qtyIssue: 0 },
          ],
        ];
        emptyRows++;
      }

      await prisma.$transaction(async (tx) => {
        await tx.inventoryBinStock.deleteMany({
          where: { inventoryId: inv.id },
        });
        await tx.inventoryBinStock.createMany({
          data: rows.map(([binId, q]) => ({
            inventoryId: inv.id,
            binId,
            availQty: q.avail,
            reservedQty: q.reserved,
            inTransitQty: q.inTransit,
            qualityIssue: q.quality,
            qtyIssue: q.qtyIssue,
          })),
        });
      });

      touched++;
      rowsWritten += rows.length;
    }

    logger.log(
      `Done: ${touched} inventory row(s) laid out over ${rowsWritten} bin row(s); ` +
        `${emptyRows} had nothing on hand and kept a single Virtual row.`,
    );
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
