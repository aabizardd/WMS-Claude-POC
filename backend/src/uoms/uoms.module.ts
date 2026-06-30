import { Module } from '@nestjs/common';
import { UomsService } from './uoms.service';
import { UomsController } from './uoms.controller';

@Module({
  controllers: [UomsController],
  providers: [UomsService],
})
export class UomsModule {}
