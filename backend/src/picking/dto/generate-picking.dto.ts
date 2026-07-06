import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeneratePickingItemDto {
  @IsString()
  salesOrderItemId!: string;

  @IsNumber()
  @Min(0.0001)
  requestQty!: number;

  @IsString()
  binId!: string;

  @IsInt()
  pickerId!: number;
}

export class GeneratePickingDto {
  @IsString()
  salesOrderId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GeneratePickingItemDto)
  items!: GeneratePickingItemDto[];
}
