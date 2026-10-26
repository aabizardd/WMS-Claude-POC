import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

/** Fields SD Tracking can filter on (see DELIVERY_FILTERS in the service). */
export const DELIVERY_FILTER_KEYS = [
  'material_code',
  'material_name',
  'warehouse_id',
  'to_warehouse_id',
  'warehouse_name',
  'to_warehouse_name',
  'customer_name',
  'created_by_name',
  'sdo_id',
  'tran_id',
  'customer_id',
  'oracle_id',
  'packing_code',
  'created_by_id',
] as const;

export class DeliveryFilterDto {
  @IsIn(DELIVERY_FILTER_KEYS)
  field!: (typeof DELIVERY_FILTER_KEYS)[number];

  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 values per filter' })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QueryDeliveryDto extends SortableQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  history?: string;

  // SALES_ORDER | TRANSFER_ORDER — filters the delivery/history list by source.
  @IsOptional()
  @IsString()
  source?: string;

  // "all" lists every status (Delivery Plan, SD Tracking); otherwise Open only,
  // or Closed with history=true.
  @IsOptional()
  @IsIn(['all'])
  status?: 'all';

  // 'true' adds each delivery's lines to its row (the list's accordion).
  @IsOptional()
  @IsIn(['true', 'false'])
  include_items?: string;

  /** Delivery Plan filters, sent as one JSON string. */
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
    return plainToInstance(DeliveryFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  filters?: DeliveryFilterDto[];
}
