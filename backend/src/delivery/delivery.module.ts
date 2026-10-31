import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { TransferOrdersModule } from '../transfer-orders/transfer-orders.module';

@Module({
  imports: [InventoryModule, SalesOrdersModule, TransferOrdersModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
