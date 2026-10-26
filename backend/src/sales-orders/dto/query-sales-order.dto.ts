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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

/**
 * Columns the list can be filtered on. The `item_*` ones look inside the order's
 * lines; every other field is on the order itself.
 */
export const SALES_ORDER_FILTER_FIELDS = [
  'tran_id',
  'oracle_id',
  'customer_name',
  // Matched on the warehouse id: the field is a dropdown, and several sites
  // share a name apart from their capitalisation.
  'warehouse_id',
  // Free text on the warehouse name.
  'warehouse_name',
  'status_name',
  'delivery_status',
  'memo',
  'item_name',
  'material_code',
  'material_name',
  'item_description',
  'created_at',
] as const;

export type SalesOrderFilterField = (typeof SALES_ORDER_FILTER_FIELDS)[number];

/** Filters that match against the order's lines rather than its header. */
export const SALES_ORDER_ITEM_FIELDS: SalesOrderFilterField[] = [
  'item_name',
  'material_code',
  'material_name',
  'item_description',
];

/** Filters whose value is a "from..to" date range rather than free text. */
export const SALES_ORDER_DATE_FIELDS: SalesOrderFilterField[] = ['created_at'];

/**
 * The most filters one request may carry. The tracking page lays every column
 * out as its own field, so the ceiling is one filter per column.
 */
export const SALES_ORDER_FILTER_MAX = SALES_ORDER_FILTER_FIELDS.length;
/** The most values one filter may carry; they are OR-ed together. */
export const SALES_ORDER_FILTER_VALUES_MAX = 10;

export class SalesOrderFilterDto {
  @IsIn(SALES_ORDER_FILTER_FIELDS)
  field!: SalesOrderFilterField;

  // Several values on one column mean "any of these"; columns stay AND-ed.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SALES_ORDER_FILTER_VALUES_MAX, {
    message: `At most ${SALES_ORDER_FILTER_VALUES_MAX} values per filter`,
  })
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QuerySalesOrderDto extends SortableQueryDto {
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

  // Free text across SO number / customer / Oracle id. Kept for callers that
  // predate the per-column filters.
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

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
              'filters must be a JSON array of {field, value}',
            );
          }
        })();
    if (!Array.isArray(raw)) {
      throw new BadRequestException(
        'filters must be a JSON array of {field, value}',
      );
    }
    return plainToInstance(SalesOrderFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(SALES_ORDER_FILTER_MAX, {
    message: `At most ${SALES_ORDER_FILTER_MAX} filters can be combined`,
  })
  @ValidateNested({ each: true })
  filters?: SalesOrderFilterDto[];
}
