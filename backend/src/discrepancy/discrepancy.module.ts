import { Module } from '@nestjs/common';
import { DiscrepancyService } from './discrepancy.service';
import { DiscrepancyController } from './discrepancy.controller';

@Module({
  controllers: [DiscrepancyController],
  providers: [DiscrepancyService],
  exports: [DiscrepancyService], // used by Goods Receive on successful receive
})
export class DiscrepancyModule {}
