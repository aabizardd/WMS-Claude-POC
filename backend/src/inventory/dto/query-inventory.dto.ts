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
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

/** Columns the list can be filtered on. Mapped to Prisma in the service. */
export const INVENTORY_FILTER_FIELDS = [
  'material_code',
  'material_name',
  'material_type',
  'material_category',
  'primary_uom',
  // Matched on the warehouse id: several sites share a name apart from their
  // capitalisation, so a text match would mix them up.
  'warehouse_id',
  // Free text on the warehouse name.
  'warehouse_name',
  'bin',
] as const;

export type InventoryFilterField = (typeof INVENTORY_FILTER_FIELDS)[number];

/**
 * The most filters one request may carry. The tracking page lays every column
 * out as its own field, so the ceiling is simply one filter per column.
 */
export const INVENTORY_FILTER_MAX = INVENTORY_FILTER_FIELDS.length;
/** The most values one filter may carry; they are OR-ed together. */
export const INVENTORY_FILTER_VALUES_MAX = 10;

export class InventoryFilterDto {
  @IsIn(INVENTORY_FILTER_FIELDS)
  field!: InventoryFilterField;

  // Several values on one column mean "any of these"; columns stay AND-ed.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INVENTORY_FILTER_VALUES_MAX, {
    message: `At most ${INVENTORY_FILTER_VALUES_MAX} values per filter`,
  })
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

export class QueryInventoryDto extends SortableQueryDto {
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

  // Free-text across material code + name. Kept for callers that predate the
  // per-field filters below.
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Up to five per-column filters, combined with AND. Sent as a JSON string so
   * one query param carries the whole set regardless of how the HTTP client
   * serialises arrays of objects.
   *
   * The parsed entries are turned into DTO instances here rather than with
   * `@Type`: a `@Transform` on the same property replaces that conversion, and
   * plain objects would then be stripped by the global whitelist.
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
            // Rejected outright: silently dropping a malformed filter would
            // answer with the whole unfiltered table, which reads as a result.
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
    return plainToInstance(InventoryFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(INVENTORY_FILTER_MAX, {
    message: `At most ${INVENTORY_FILTER_MAX} filters can be combined`,
  })
  @ValidateNested({ each: true })
  filters?: InventoryFilterDto[];

  // "true" adds each row's bin breakdown, so the list can open every row's
  // accordion without a request per row.
  @IsOptional()
  @IsString()
  include_bins?: string;
}
