import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { MrnSyncService } from '../mrn/mrn-sync.service';

/**
 * One-off Oracle (PIB inTransit) -> WMS MRN sync from the command line.
 *
 *   npm run sync:mrn                              # full sync
 *   npm run sync:mrn -- 2026-06-25T14:26:15+07:00   # incremental
 */
async function run() {
  const logger = new Logger('sync-mrn');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const lastModified = process.argv[2];
    const sync = app.get(MrnSyncService);
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
