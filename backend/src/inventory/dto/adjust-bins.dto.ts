import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdjustBinLineDto {
  // null/omitted => the "no bin" bucket (existing null-bin stock row).
  @IsOptional()
  @IsString()
  bin_id?: string | null;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  avail_qty!: number;
}

export class AdjustBinsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AdjustBinLineDto)
  bins!: AdjustBinLineDto[];
}
