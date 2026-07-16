import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { TransferOrderSyncService } from '../transfer-orders/transfer-order-sync.service';

/**
 * One-off Oracle -> WMS Transfer Order sync (Outbound from Transfer Stock).
 *
 *   npm run sync:transfer-orders                              # full sync
 *   npm run sync:transfer-orders -- 2026-07-15T10:50:00+07:00 # incremental
 */
async function run() {
  const logger = new Logger('sync-transfer-orders');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(TransferOrderSyncService);
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
