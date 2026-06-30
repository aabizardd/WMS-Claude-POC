import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateMaterialDto {
  @IsString()
  @IsNotEmpty()
  materialName!: string;

  @IsString()
  @IsNotEmpty()
  materialCode!: string;

  @IsOptional()
  @IsUUID()
  materialCategoryId?: string;

  @IsOptional()
  @IsUUID()
  materialTypeId?: string;

  @IsOptional()
  @IsUUID()
  primaryUomId?: string;

  @IsOptional()
  @IsUUID()
  secondaryUomId?: string;

  @IsOptional()
  @IsUUID()
  weightUomId?: string;

  @IsOptional()
  @IsUUID()
  dimensionUomId?: string;

  @IsOptional()
  @IsNumber()
  conversionRateQuantity?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  materialLength?: number;

  @IsOptional()
  @IsNumber()
  materialWidth?: number;

  @IsOptional()
  @IsNumber()
  materialHeight?: number;

  @IsOptional()
  @IsNumber()
  materialWeight?: number;

  @IsOptional()
  @IsNumber()
  materialQty?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
