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
import { IA_TYPES } from '../ia-rules';
import { IA_FILTER_FIELDS, type IaFilterField } from '../inventory-adjustments.service';

export class IaFilterDto {
  @IsIn(IA_FILTER_FIELDS)
  field!: IaFilterField;

  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 values per filter' })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

const STATUSES = [
  'WaitingApproval',
  'Approved',
  'Rejected',
  'WaitingOracleApproval',
  'Completed',
  'RejectedByOracle',
];

export class QueryInventoryAdjustmentDto extends SortableQueryDto {
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

  // An empty query param ("?status=") means "no filter", not an invalid value.
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(IA_TYPES)
  adjustment_type?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(STATUSES)
  status?: string;

  /** List filters, sent as one JSON string of [{field, values}]. */
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
    return plainToInstance(IaFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  filters?: IaFilterDto[];
}
