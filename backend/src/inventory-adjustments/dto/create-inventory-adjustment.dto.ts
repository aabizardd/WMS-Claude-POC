import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IA_TYPES } from '../ia-rules';

export class AdjustmentItemDto {
  @IsUUID()
  material_id!: string;

  @IsUUID()
  bin_id!: string;

  // Free signed delta (Assembly / Disassembly / Cycle Count / Stock Opname).
  // Ignored for the Discrepancy types: the server fills it from the bin bucket.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  qty_adjustment?: number;

  // Quality Adjustment only. Both positive.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  qty_passed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  qty_non_passed?: number;
}

export class CreateInventoryAdjustmentDto {
  // FR-IA-01 rule 2: mandatory.
  @IsIn(IA_TYPES)
  adjustment_type!: string;

  // Header class — its Class.oracleId is sent to Oracle.
  @IsUUID()
  class_id!: string;

  // FR-IA-02: optional free text.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  memo?: string;

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
