import { BadRequestException } from '@nestjs/common';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

/** Fields the PIB Goods Receive list can be filtered on (WMS dev's, plus Nomor Aju). */
export const PIB_GR_FILTER_FIELDS = [
  'material_code',
  'aju_number',
  'warehouse',
  'created_at',
  'vessel_number',
  'material_name',
  'bill_of_lading',
  'transaction_id',
  'erp_doc_id',
] as const;
export type PibGrFilterField = (typeof PIB_GR_FILTER_FIELDS)[number];

export class PibGrFilterDto {
  @IsIn(PIB_GR_FILTER_FIELDS)
  field!: PibGrFilterField;

  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 values per filter' })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QueryPibInboundDto extends SortableQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  /** List filters, sent as one JSON string (Goods Receive list). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    let raw: unknown = value;
    if (!Array.isArray(value)) {
      try {
        raw = JSON.parse(String(value));
      } catch {
        throw new BadRequestException('filters must be a JSON array of {field, values}');
      }
    }
    if (!Array.isArray(raw)) throw new BadRequestException('filters must be a JSON array of {field, values}');
    return plainToInstance(PibGrFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  filters?: PibGrFilterDto[];

  /** "true" adds each GR's lines, for the list's accordion. */
  @IsOptional()
  @IsString()
  include_items?: string;
}
