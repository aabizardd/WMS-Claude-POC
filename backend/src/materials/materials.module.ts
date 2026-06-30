import { Module } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { MaterialsController } from './materials.controller';
import { ErpSyncService } from './erp-sync.service';

@Module({
  controllers: [MaterialsController],
  providers: [MaterialsService, ErpSyncService],
  exports: [ErpSyncService],
})
export class MaterialsModule {}
