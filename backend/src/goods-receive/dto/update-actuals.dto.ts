import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ActualItemDto {
  @IsUUID()
  id!: string; // MRN item id

  @IsNumber()
  @Min(0)
  qtyActual!: number;

  // Destination bin (optional; null clears it).
  @IsOptional()
  @ValidateIf((o) => o.binId !== null)
  @IsUUID()
  binId?: string | null;
}

export class UpdateActualsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActualItemDto)
  items!: ActualItemDto[];
}
