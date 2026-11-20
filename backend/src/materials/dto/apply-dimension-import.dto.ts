import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { DIMENSION_IMPORT_MAX_ROWS } from '../material-dimension-import';

/** One material's checked changes from the preview; absent fields stay as they are. */
export class DimensionChangeDto {
  @IsString()
  id!: string;

  @IsOptional() @IsNumber() @Min(0) material_length?: number;
  @IsOptional() @IsNumber() @Min(0) material_width?: number;
  @IsOptional() @IsNumber() @Min(0) material_height?: number;
  @IsOptional() @IsNumber() @Min(0) material_weight?: number;
  @IsOptional() @IsString() dimension_uom_id?: string;
  @IsOptional() @IsString() weight_uom_id?: string;
}

export class ApplyDimensionImportDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Nothing to apply' })
  @ArrayMaxSize(DIMENSION_IMPORT_MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => DimensionChangeDto)
  rows!: DimensionChangeDto[];
}
