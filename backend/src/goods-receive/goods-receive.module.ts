import { Module } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { GoodsReceiveReceiveService } from './goods-receive-receive.service';
import { GoodsReceiveController } from './goods-receive.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { DiscrepancyModule } from '../discrepancy/discrepancy.module';

@Module({
  imports: [InventoryModule, DiscrepancyModule],
  controllers: [GoodsReceiveController],
  providers: [GoodsReceiveService, GoodsReceiveReceiveService],
})
export class GoodsReceiveModule {}
