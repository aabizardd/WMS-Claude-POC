import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ErpSyncService } from '../materials/erp-sync.service';

/**
 * One-off ERP -> WMS materials sync from the command line. This is the INITIAL
 * INJECT path and DOES write qty_available (per-location availability) by
 * default — the scheduler and the manual "Sync from ERP" button do NOT.
 *
 *   npm run sync:erp                      # full inject (writes qty_available)
 *   npm run sync:erp -- 2024-06-25T09:04:00+07:00   # incremental since date
 *   npm run sync:erp -- --no-avail        # sync materials only, skip qty_available
 */
async function run() {
  const logger = new Logger('sync-erp');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const args = process.argv.slice(2);
    const noAvail = args.includes('--no-avail');
    const lastModified = args.find((a) => !a.startsWith('--')); // optional ISO datetime
    const sync = app.get(ErpSyncService);
    const result = await sync.sync({
      lastModified,
      syncAvailability: !noAvail,
    });
    logger.log(`Done: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
