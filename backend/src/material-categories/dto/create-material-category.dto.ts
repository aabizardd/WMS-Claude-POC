import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMaterialCategoryDto {
  @IsString()
  @IsNotEmpty()
  materialCategoryName!: string;

  @IsString()
  @IsNotEmpty()
  materialCategoryCode!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
