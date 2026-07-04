import { Module } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrderSyncService } from './sales-order-sync.service';
import { SalesOrdersController } from './sales-orders.controller';

@Module({
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService, SalesOrderSyncService],
  exports: [SalesOrderSyncService],
})
export class SalesOrdersModule {}
