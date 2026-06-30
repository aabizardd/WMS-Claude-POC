import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMaterialTypeDto {
  @IsString()
  @IsNotEmpty()
  materialTypeName!: string;

  @IsString()
  @IsNotEmpty()
  materialTypeCode!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
