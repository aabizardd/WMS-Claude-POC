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

/** Fields the Customer Return Request (CR) list can be filtered on. */
export const CR_FILTER_FIELDS = [
  'material_code',
  'warehouse',
  'created_at',
  'material_name',
  'transaction_id',
  'erp_doc_id',
  'customer',
  'so_return_number',
] as const;
export type CrFilterField = (typeof CR_FILTER_FIELDS)[number];

export class CrFilterDto {
  @IsIn(CR_FILTER_FIELDS)
  field!: CrFilterField;

  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 values per filter' })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QueryCustomerReturnDto extends SortableQueryDto {
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

  /** List filters, sent as one JSON string. */
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
    return plainToInstance(CrFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  filters?: CrFilterDto[];

  /** "true" adds each return's lines, for the list's accordion. */
  @IsOptional()
  @IsString()
  include_items?: string;
}
