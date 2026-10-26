import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

/**
 * Columns the list can be filtered on. The `item_*` ones look inside the
 * document's lines; every other field is on the document itself.
 */
export const SALES_DELIVERY_FILTER_FIELDS = [
  'delivery_number',
  'document_type',
  'from_warehouse',
  // Exact match on the Origin warehouse id (the tracking page's dropdown).
  'from_warehouse_id',
  'to_warehouse',
  'customer',
  'department',
  'class',
  'status',
  'memo',
  'created_by',
  // Exact match on the creator's user id (the tracking page's dropdown).
  'created_by_id',
  'created_at',
  'material_code',
  'material_name',
  'bin',
  'remarks',
] as const;

export type SalesDeliveryFilterField =
  (typeof SALES_DELIVERY_FILTER_FIELDS)[number];

/** Filters matched against the document's lines rather than its header. */
export const SALES_DELIVERY_ITEM_FIELDS: SalesDeliveryFilterField[] = [
  'material_code',
  'material_name',
  'bin',
  'remarks',
];

/** Filters whose value is a "from..to" date range rather than free text. */
export const SALES_DELIVERY_DATE_FIELDS: SalesDeliveryFilterField[] = [
  'created_at',
];

export const SALES_DELIVERY_FILTER_MAX = 10;
/** The most values one filter may carry; they are OR-ed together. */
export const SALES_DELIVERY_FILTER_VALUES_MAX = 10;

export class SalesDeliveryFilterDto {
  @IsIn(SALES_DELIVERY_FILTER_FIELDS)
  field!: SalesDeliveryFilterField;

  // Several values on one column mean "any of these"; columns stay AND-ed.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SALES_DELIVERY_FILTER_VALUES_MAX, {
    message: `At most ${SALES_DELIVERY_FILTER_VALUES_MAX} values per filter`,
  })
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QuerySalesDeliveryDto extends SortableQueryDto {
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

  // Free text on the delivery number. Kept for callers that predate the
  // per-column filters.
  @IsOptional()
  @IsString()
  search?: string;

  // The plain list's destination dropdown. An empty query param
  // ("?to_warehouse_id=") means "no filter".
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  to_warehouse_id?: string;

  // The list's Delivery / Return toggle. Kept apart from `filters` so it never
  // takes one of the five filter slots.
  @IsOptional()
  @IsIn(['SalesDelivery', 'SalesReturn'])
  document_type?: 'SalesDelivery' | 'SalesReturn';

  // 'true' adds each document's lines to its row (the list's accordion).
  @IsOptional()
  @IsIn(['true', 'false'])
  include_items?: string;

  /**
   * Up to five per-column filters, combined with AND. Sent as a JSON string so
   * one query param carries the whole set regardless of how the HTTP client
   * serialises arrays of objects. Instances are built here rather than with
   * `@Type`, which a `@Transform` on the same property would replace.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    const raw: unknown = Array.isArray(value)
      ? value
      : (() => {
          try {
            return JSON.parse(String(value));
          } catch {
            throw new BadRequestException(
              'filters must be a JSON array of {field, values}',
            );
          }
        })();
    if (!Array.isArray(raw)) {
      throw new BadRequestException(
        'filters must be a JSON array of {field, values}',
      );
    }
    return plainToInstance(SalesDeliveryFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(SALES_DELIVERY_FILTER_MAX, {
    message: `At most ${SALES_DELIVERY_FILTER_MAX} filters can be combined`,
  })
  @ValidateNested({ each: true })
  filters?: SalesDeliveryFilterDto[];
}
