import { Module } from '@nestjs/common';
import { PackingService } from './packing.service';
import { PackingController } from './packing.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [PackingController],
  providers: [PackingService],
})
export class PackingModule {}
