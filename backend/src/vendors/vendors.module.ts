import { Module } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorSyncService } from './vendor-sync.service';
import { VendorsController } from './vendors.controller';

@Module({
  controllers: [VendorsController],
  providers: [VendorsService, VendorSyncService],
  exports: [VendorSyncService],
})
export class VendorsModule {}
