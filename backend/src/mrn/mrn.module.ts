import { Module } from '@nestjs/common';
import { MrnService } from './mrn.service';
import { MrnSyncService } from './mrn-sync.service';
import { MrnController } from './mrn.controller';

@Module({
  controllers: [MrnController],
  providers: [MrnService, MrnSyncService],
  exports: [MrnSyncService],
})
export class MrnModule {}
