import { Module } from '@nestjs/common';
import { TransferOrdersController } from './transfer-orders.controller';
import { TransferOrdersService } from './transfer-orders.service';
import { TransferOrderSyncService } from './transfer-order-sync.service';

@Module({
  controllers: [TransferOrdersController],
  providers: [TransferOrdersService, TransferOrderSyncService],
  exports: [TransferOrderSyncService],
})
export class TransferOrdersModule {}
