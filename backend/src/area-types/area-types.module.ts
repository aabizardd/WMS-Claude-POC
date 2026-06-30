import { Module } from '@nestjs/common';
import { AreaTypesService } from './area-types.service';
import { AreaTypesController } from './area-types.controller';

@Module({
  controllers: [AreaTypesController],
  providers: [AreaTypesService],
})
export class AreaTypesModule {}
