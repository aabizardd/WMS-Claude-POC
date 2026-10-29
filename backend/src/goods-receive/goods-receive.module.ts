import { Module } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { GoodsReceiveReceiveService } from './goods-receive-receive.service';
import { GoodsReceiveFromPoService } from './goods-receive-from-po.service';
import { GoodsReceiveFromToService } from './goods-receive-from-to.service';
import { GoodsReceiveController } from './goods-receive.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { DiscrepancyModule } from '../discrepancy/discrepancy.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { TransferOrdersModule } from '../transfer-orders/transfer-orders.module';
import { MrnModule } from '../mrn/mrn.module';

@Module({
  imports: [InventoryModule, DiscrepancyModule, PurchaseOrdersModule, TransferOrdersModule, MrnModule],
  controllers: [GoodsReceiveController],
  providers: [
    GoodsReceiveService,
    GoodsReceiveReceiveService,
    GoodsReceiveFromPoService,
    GoodsReceiveFromToService,
  ],
})
export class GoodsReceiveModule {}
