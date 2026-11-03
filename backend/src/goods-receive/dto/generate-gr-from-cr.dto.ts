import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class GenerateGrListFromCrItemDto {
  // WMS CustomerReturnLine.id of the selected line.
  @IsString()
  lineId!: string;

  // Planned qty for this GR — at most what is still to be put on a GR.
  @IsNumber()
  @Min(0.0001)
  plannedQty!: number;
}

/** Generate GR List: an Open GR with planned quantities (no Oracle yet). */
export class GenerateGrListFromCrDto {
  @IsString()
  customerReturnId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GenerateGrListFromCrItemDto)
  items!: GenerateGrListFromCrItemDto[];
}
