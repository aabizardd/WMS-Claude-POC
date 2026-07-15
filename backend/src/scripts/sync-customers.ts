import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CustomerSyncService } from '../customers/customer-sync.service';

/**
 * One-off Oracle -> WMS customer sync from the command line.
 *
 *   npm run sync:customers                              # full sync
 *   npm run sync:customers -- 2026-06-18T18:20:00+07:00   # incremental
 */
async function run() {
  const logger = new Logger('sync-customers');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(CustomerSyncService);
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
