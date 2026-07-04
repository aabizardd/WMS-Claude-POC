import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { SalesOrderSyncService } from '../sales-orders/sales-order-sync.service';

/**
 * One-off Oracle -> WMS Sales Order sync from the command line.
 *
 *   npm run sync:sales-orders                              # full sync
 *   npm run sync:sales-orders -- 2026-06-15T13:43:00+07:00 # incremental
 */
async function run() {
  const logger = new Logger('sync-sales-orders');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(SalesOrderSyncService);
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
