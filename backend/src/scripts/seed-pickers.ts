import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';

/**
 * Give every warehouse enough pickers to assign picking / putaway work to.
 *
 *   npm run seed:pickers
 *
 * A picker is an active user with the `picker` role, assigned to one
 * warehouse (that is what the Picker dropdowns list). Every active warehouse
 * of the allowed subsidiary is topped up to MIN_PER_WAREHOUSE pickers:
 * `picker_<warehouse oracle id>_<nn>`, e.g. picker_225_03.
 *
 * Idempotent: pickers a warehouse already has (seeded or not) count toward
 * the minimum, and re-running never creates duplicates.
 *
 * Every seeded picker gets the password in SEED_PICKER_PASSWORD (default
 * "picker123") — local test accounts only.
 */
const MIN_PER_WAREHOUSE = 10;

async function run() {
  const logger = new Logger('seed-pickers');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  try {
    const role = await prisma.role.findUnique({ where: { name: 'picker' } });
    if (!role) throw new Error('Role "picker" not found — run the main seed first.');
    if (!role.isActive) logger.warn('Role "picker" is inactive: its users cannot sign in until it is set Active.');

    const warehouses = await prisma.warehouse.findMany({
      where: { isInactive: false, subsidiaryId: subsidiarySingleFilter() },
      select: { id: true, oracleId: true, name: true, subsidiaryId: true },
      orderBy: { name: 'asc' },
    });
    const subsidiaries = await prisma.subsidiary.findMany({ select: { id: true, oracleId: true } });
    const subsidiaryByOracle = new Map(subsidiaries.map((s) => [s.oracleId, s.id]));

    const password = await bcrypt.hash(process.env.SEED_PICKER_PASSWORD ?? 'picker123', 10);
    let created = 0;

    for (const wh of warehouses) {
      const have = await prisma.user.count({
        where: { warehouses: { some: { warehouseId: wh.id } }, roleId: role.id, isActive: true },
      });
      let n = 0;
      let added = 0;
      // Fill the gap, skipping numbers whose username / email is already taken.
      while (have + added < MIN_PER_WAREHOUSE) {
        n += 1;
        const nn = String(n).padStart(2, '0');
        const username = `picker_${wh.oracleId}_${nn}`;
        const email = `picker.${wh.oracleId}.${nn}@wms.local`;
        const taken = await prisma.user.findFirst({
          where: { OR: [{ username }, { email }, { employeeId: `PCK-${wh.oracleId}-${nn}` }] },
          select: { id: true },
        });
        if (taken) continue;
        await prisma.user.create({
          data: {
            name: `Picker ${nn} ${wh.name}`,
            firstName: `Picker ${nn}`,
            lastName: wh.name,
            username,
            email,
            employeeId: `PCK-${wh.oracleId}-${nn}`,
            password,
            isActive: true,
            roleId: role.id,
            warehouses: { create: { warehouseId: wh.id } },
            subsidiaryId: wh.subsidiaryId ? (subsidiaryByOracle.get(wh.subsidiaryId) ?? null) : null,
          },
        });
        added += 1;
      }
      created += added;
      logger.log(`${wh.name}: ${have} existing + ${added} new = ${have + added} pickers`);
    }

    logger.log(`Done — ${created} picker(s) created across ${warehouses.length} warehouse(s).`);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
