import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderSyncService } from './purchase-order-sync.service';

@Module({
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PurchaseOrderSyncService],
  exports: [PurchaseOrderSyncService],
})
export class PurchaseOrdersModule {}
