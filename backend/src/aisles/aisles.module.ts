import { Module } from '@nestjs/common';
import { AislesService } from './aisles.service';
import { AislesController } from './aisles.controller';

@Module({
  controllers: [AislesController],
  providers: [AislesService],
})
export class AislesModule {}
