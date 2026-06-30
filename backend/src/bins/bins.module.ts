import { Module } from '@nestjs/common';
import { BinsService } from './bins.service';
import { BinsController } from './bins.controller';

@Module({
  controllers: [BinsController],
  providers: [BinsService],
})
export class BinsModule {}
