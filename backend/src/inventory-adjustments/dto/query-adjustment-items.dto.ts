import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

/** Columns the detail's Adjustment Bins table can be sorted on. */
export const IA_ITEM_SORT_FIELDS = [
  'material_code',
  'material_name',
  'warehouse',
  'bin',
  'before_qty',
  'qty_adjustment',
  'qty_passed',
  'qty_non_passed',
] as const;

/** One page of an adjustment's lines (the detail's Adjustment Bins tab). */
export class QueryAdjustmentItemsDto extends SortableQueryDto {
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

  /** Material code / name or bin code / label. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Only the lines of this warehouse (a document can span several). */
  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  /** Only additions or only reductions. */
  @IsOptional()
  @IsIn(['positive', 'negative'])
  qty_sign?: 'positive' | 'negative';
}
