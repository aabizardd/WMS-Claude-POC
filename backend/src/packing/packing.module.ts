import { Module } from '@nestjs/common';
import { PackingService } from './packing.service';
import { PackingController } from './packing.controller';

@Module({
  controllers: [PackingController],
  providers: [PackingService],
})
export class PackingModule {}
