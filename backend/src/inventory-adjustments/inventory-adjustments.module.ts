import { Module } from '@nestjs/common';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  // InventoryService owns the stock ledger writer (recordMovement).
  imports: [InventoryModule],
  controllers: [InventoryAdjustmentsController],
  providers: [InventoryAdjustmentsService],
})
export class InventoryAdjustmentsModule {}
