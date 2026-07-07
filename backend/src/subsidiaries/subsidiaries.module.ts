import { Module } from '@nestjs/common';
import { SubsidiariesService } from './subsidiaries.service';
import { SubsidiarySyncService } from './subsidiary-sync.service';
import { SubsidiariesController } from './subsidiaries.controller';

@Module({
  controllers: [SubsidiariesController],
  providers: [SubsidiariesService, SubsidiarySyncService],
  exports: [SubsidiarySyncService],
})
export class SubsidiariesModule {}
