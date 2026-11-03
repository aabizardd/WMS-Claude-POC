import { Module } from '@nestjs/common';
import { CustomerReturnsController } from './customer-returns.controller';
import { CustomerReturnsService } from './customer-returns.service';
import { CustomerReturnSyncService } from './customer-return-sync.service';

@Module({
  controllers: [CustomerReturnsController],
  providers: [CustomerReturnsService, CustomerReturnSyncService],
  exports: [CustomerReturnSyncService],
})
export class CustomerReturnsModule {}
