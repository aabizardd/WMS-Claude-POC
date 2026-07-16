import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeneratePickingItemDto {
  // Exactly one of salesOrderItemId / transferOrderItemId is set (matches the
  // picking source).
  @IsOptional()
  @IsString()
  salesOrderItemId?: string;

  @IsOptional()
  @IsString()
  transferOrderItemId?: string;

  @IsNumber()
  @Min(0.0001)
  requestQty!: number;

  @IsString()
  binId!: string;

  @IsInt()
  pickerId!: number;
}

export class GeneratePickingDto {
  // Source is a Sales Order OR a Transfer Order — exactly one is provided.
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsString()
  transferOrderId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GeneratePickingItemDto)
  items!: GeneratePickingItemDto[];
}
