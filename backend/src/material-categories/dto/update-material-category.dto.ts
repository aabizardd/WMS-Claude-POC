import { PartialType } from '@nestjs/mapped-types';
import { CreateMaterialCategoryDto } from './create-material-category.dto';

export class UpdateMaterialCategoryDto extends PartialType(
  CreateMaterialCategoryDto,
) {}
