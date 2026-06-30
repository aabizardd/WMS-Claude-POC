import { Module } from '@nestjs/common';
import { MaterialCategoriesService } from './material-categories.service';
import { MaterialCategoriesController } from './material-categories.controller';

@Module({
  controllers: [MaterialCategoriesController],
  providers: [MaterialCategoriesService],
})
export class MaterialCategoriesModule {}
