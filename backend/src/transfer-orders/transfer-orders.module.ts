import { Module } from '@nestjs/common';
import { TransferOrdersController } from './transfer-orders.controller';
import { TransferOrdersService } from './transfer-orders.service';
import { TransferOrderSyncService } from './transfer-order-sync.service';
import { TransferOrderCreateService } from './transfer-order-create.service';

@Module({
  controllers: [TransferOrdersController],
  providers: [TransferOrdersService, TransferOrderSyncService, TransferOrderCreateService],
  exports: [TransferOrderSyncService],
})
export class TransferOrdersModule {}
