import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { WarehouseSyncService } from '../warehouses/warehouse-sync.service';

/**
 * One-off Oracle -> WMS warehouse (locations) sync from the command line.
 *
 *   npm run sync:warehouses                          # full sync
 *   npm run sync:warehouses -- 2026-04-06T00:00:00+07:00   # incremental
 */
async function run() {
  const logger = new Logger('sync-warehouses');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(WarehouseSyncService);
    const result = await sync.sync({ lastModified });
    logger.log(`Done: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
