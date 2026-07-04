import { Module } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { PutawayController } from './putaway.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [PutawayController],
  providers: [PutawayService],
})
export class PutawayModule {}
