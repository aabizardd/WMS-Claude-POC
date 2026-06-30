import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerSyncService } from './customer-sync.service';
import { CustomersController } from './customers.controller';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerSyncService],
  exports: [CustomerSyncService],
})
export class CustomersModule {}
