import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsIn,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SalesDeliveryItemDto {
  @IsUUID()
  material_id!: string;

  @IsUUID()
  bin_id!: string;

  // Free note for this bin line. Optional.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  // Always positive — a transfer never moves a negative quantity.
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive({ message: 'Qty Transfer must be greater than 0' })
  qty_transfer!: number;
}

export class CreateSalesDeliveryDto {
  /**
   * SalesReturn reverses a delivery: it is raised from a billing warehouse and
   * must name the delivery it was copied from. Defaults to a plain delivery.
   */
  @IsOptional()
  @IsIn(['SalesDelivery', 'SalesReturn'])
  document_type?: 'SalesDelivery' | 'SalesReturn';

  /**
   * A document number typed by the user ("Manual Input" on the form). Left out,
   * the system generates SD-YYYYMMDD-NNN (or SR-… for a return). Must be unique.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'SD / SR Number cannot be empty' })
  @MaxLength(100, { message: 'SD / SR Number can be at most 100 characters' })
  delivery_number?: string;

  // Required for a return; rejected on a delivery.
  @IsOptional()
  @IsUUID()
  source_delivery_id?: string;

  // Both picked on the form from the active warehouses; they must differ.
  @IsUUID()
  from_warehouse_id!: string;

  @IsUUID()
  to_warehouse_id!: string;

  // Who the delivery is for. Optional: documents created before the Customer
  // field existed have none, and the print falls back to a dash.
  @IsOptional()
  @IsUUID()
  customer_id?: string;

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
