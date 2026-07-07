import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdjustmentItemDto {
  @IsUUID()
  material_id!: string;

  @IsUUID()
  bin_id!: string;

  // qty_issue type
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  qty_adjustment?: number;

  // quality_issue type
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  qty_scrapped?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  qty_passed?: number;
}

export class CreateInventoryAdjustmentDto {
  @IsIn(['qty_issue', 'quality_issue'])
  adjustment_type!: 'qty_issue' | 'quality_issue';

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemDto)
  items!: AdjustmentItemDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  discrepancy_ids?: string[];
}
