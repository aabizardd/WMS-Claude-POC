import { Module } from '@nestjs/common';
import { MaterialTypesService } from './material-types.service';
import { MaterialTypesController } from './material-types.controller';

@Module({
  controllers: [MaterialTypesController],
  providers: [MaterialTypesService],
})
export class MaterialTypesModule {}
