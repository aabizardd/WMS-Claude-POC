import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Oracle's memo field holds up to 999 characters. */
export const TO_TEXT_MAX = 999;
export const TO_LINE_DESCRIPTION_MAX = 300;
export const TO_MAX_LINES = 200;

export class CreateTransferOrderItemDto {
  // WMS Material.id; Oracle gets its erp_doc_id.
  @IsUUID()
  material_id!: string;

  // Qty requested — at most what the sending warehouse has available.
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(TO_LINE_DESCRIPTION_MAX)
  description?: string;
}

/** A new Transfer Order, created straight in Oracle. */
export class CreateTransferOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(TO_TEXT_MAX)
  memo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TO_TEXT_MAX)
  note_approval?: string;

  @IsUUID()
  class_id!: string;

  @IsUUID()
  department_id!: string;

  // Sending warehouse (Oracle "location").
  @IsUUID()
  from_warehouse_id!: string;

  // Receiving warehouse (Oracle "transferlocation") — one of the user's own.
  @IsUUID()
  to_warehouse_id!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(TO_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferOrderItemDto)
  items!: CreateTransferOrderItemDto[];

  // true: saved as a Draft (WMS only, still editable). Otherwise submitted:
  // sent to Oracle for approval.
  @IsOptional()
  @IsBoolean()
  draft?: boolean;
}
