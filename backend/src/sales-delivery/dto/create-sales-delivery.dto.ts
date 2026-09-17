import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SalesDeliveryItemDto {
  @IsUUID()
  material_id!: string;

  @IsUUID()
  bin_id!: string;

  // Always positive — a transfer never moves a negative quantity.
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive({ message: 'Qty Transfer must be greater than 0' })
  qty_transfer!: number;
}

export class CreateSalesDeliveryDto {
  // Both picked on the form from the active warehouses; they must differ.
  @IsUUID()
  from_warehouse_id!: string;

  @IsUUID()
  to_warehouse_id!: string;

  // Defaulted from the creator's department on the form, but overridable.
  @IsUUID()
  department_id!: string;

  @IsUUID()
  class_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  memo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesDeliveryItemDto)
  items!: SalesDeliveryItemDto[];
}
