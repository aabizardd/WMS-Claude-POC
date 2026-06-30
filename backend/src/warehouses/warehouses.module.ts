import { Module } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { WarehouseSyncService } from './warehouse-sync.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehouseSyncService],
  exports: [WarehouseSyncService],
})
export class WarehousesModule {}
