import { Module } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { MaterialsController } from './materials.controller';
import { ErpSyncService } from './erp-sync.service';
import { MaterialDimensionImportService } from './material-dimension-import.service';

@Module({
  controllers: [MaterialsController],
  providers: [MaterialsService, ErpSyncService, MaterialDimensionImportService],
  exports: [ErpSyncService],
})
export class MaterialsModule {}
