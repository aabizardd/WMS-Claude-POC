import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProgressPackingItemDto {
  @IsString()
  id!: string;

  @IsNumber()
  @Min(0)
  actualQty!: number;

  @IsNumber()
  @Min(0)
  qtyIssue!: number;

  @IsNumber()
  @Min(0)
  qualityIssue!: number;
}

export class ProgressPackingDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProgressPackingItemDto)
  items!: ProgressPackingItemDto[];
}
