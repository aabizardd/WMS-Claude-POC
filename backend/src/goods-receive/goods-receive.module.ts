import { Module } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { GoodsReceiveReceiveService } from './goods-receive-receive.service';
import { GoodsReceiveFromPoService } from './goods-receive-from-po.service';
import { GoodsReceiveController } from './goods-receive.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { DiscrepancyModule } from '../discrepancy/discrepancy.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';

@Module({
  imports: [InventoryModule, DiscrepancyModule, PurchaseOrdersModule],
  controllers: [GoodsReceiveController],
  providers: [GoodsReceiveService, GoodsReceiveReceiveService, GoodsReceiveFromPoService],
})
export class GoodsReceiveModule {}
