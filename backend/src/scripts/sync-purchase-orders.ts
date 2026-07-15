import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PurchaseOrderSyncService } from '../purchase-orders/purchase-order-sync.service';

/**
 * One-off Oracle -> WMS Purchase Order sync (Local Vendor inbound source).
 *
 *   npm run sync:purchase-orders                              # full sync
 *   npm run sync:purchase-orders -- 2026-06-15T13:43:00+07:00 # incremental
 */
async function run() {
  const logger = new Logger('sync-purchase-orders');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(PurchaseOrderSyncService);
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
