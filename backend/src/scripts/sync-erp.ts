import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ErpSyncService } from '../materials/erp-sync.service';

/**
 * One-off ERP -> WMS materials sync from the command line.
 *
 *   npm run sync:erp                      # full sync of all items
 *   npm run sync:erp -- 2024-06-25T09:04:00+07:00   # incremental since date
 */
async function run() {
  const logger = new Logger('sync-erp');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const lastModified = process.argv[2]; // optional ISO datetime
    const sync = app.get(ErpSyncService);
    const result = await sync.sync({ lastModified });
    logger.log(`Done: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
