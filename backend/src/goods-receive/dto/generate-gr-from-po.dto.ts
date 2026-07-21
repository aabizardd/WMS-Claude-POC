import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class GenerateGrFromPoItemDto {
  // WMS PurchaseOrderLine.id of the selected line.
  @IsString()
  lineId!: string;

  // Actual received qty — sent to Oracle as the item-receipt quantity.
  @IsNumber()
  @Min(0.0001)
  qtyActual!: number;
}

export class GenerateGrFromPoDto {
  @IsString()
  purchaseOrderId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GenerateGrFromPoItemDto)
  items!: GenerateGrFromPoItemDto[];
}
