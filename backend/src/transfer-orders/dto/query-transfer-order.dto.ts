import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
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

/** Fields the Transfer Order list can be filtered on. */
export const TO_FILTER_FIELDS = [
  'material_code',
  'from_warehouse_id',
  'created_at',
  'tran_id',
  'to_warehouse_id',
  'oracle_id',
  'memo',
  'from_warehouse_name',
  'to_warehouse_name',
] as const;

export class TransferOrderFilterDto {
  @IsIn(TO_FILTER_FIELDS)
  field!: (typeof TO_FILTER_FIELDS)[number];

  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 values per filter' })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QueryTransferOrderDto extends SortableQueryDto {
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
    if (!Array.isArray(raw)) {
      throw new BadRequestException('filters must be a JSON array of {field, values}');
    }
    return plainToInstance(TransferOrderFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  filters?: TransferOrderFilterDto[];

  // "true" adds each order's lines, so the list can open every accordion
  // without a request per row.
  @IsOptional()
  @IsString()
  include_items?: string;
}
