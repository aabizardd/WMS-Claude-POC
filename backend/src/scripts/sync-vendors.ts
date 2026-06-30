import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { VendorSyncService } from '../vendors/vendor-sync.service';

/**
 * One-off Oracle -> WMS vendor sync from the command line.
 *
 *   npm run sync:vendors                              # full sync
 *   npm run sync:vendors -- 2026-06-18T18:20:00+07:00   # incremental
 */
async function run() {
  const logger = new Logger('sync-vendors');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(VendorSyncService);
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
