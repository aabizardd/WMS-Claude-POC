import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateBinDto {
  @IsString()
  @IsNotEmpty()
  binLabel!: string;

  @IsString()
  @IsNotEmpty()
  binCode!: string;

  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  aisleId!: string;

  @IsUUID()
  shelfId!: string;

  @IsUUID()
  areaTypeId!: string;

  @IsOptional()
  @IsUUID()
  dimensionUomId?: string;

  @IsOptional()
  @IsNumber()
  binLength?: number;

  @IsOptional()
  @IsNumber()
  binWidth?: number;

  @IsOptional()
  @IsNumber()
  binHeight?: number;

  @IsOptional()
  @IsNumber()
  maxCapacity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
