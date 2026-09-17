import { Module } from '@nestjs/common';
import { SalesDeliveryService } from './sales-delivery.service';
import { SalesDeliveryController } from './sales-delivery.controller';

@Module({
  controllers: [SalesDeliveryController],
  providers: [SalesDeliveryService],
})
export class SalesDeliveryModule {}
