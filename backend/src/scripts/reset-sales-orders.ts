import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One-off: empty the Sales Order tables (details cascade, but cleared explicitly
 * for clarity). Run once, then re-inject from Oracle via Manual Sync / npm run
 * sync:sales-orders.
 *
 *   npm run so:reset
 */
async function run() {
  const logger = new Logger('reset-sales-orders');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const items = await prisma.salesOrderItem.deleteMany({});
    const headers = await prisma.salesOrder.deleteMany({});
    logger.log(
      `Sales Order tables emptied: ${headers.count} header(s), ${items.count} item(s) deleted.`,
    );
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
