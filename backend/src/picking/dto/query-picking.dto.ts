import { BadRequestException } from '@nestjs/common';
import { Transform, Type, plainToInstance } from 'class-transformer';
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

/** Fields the Picking and Packing lists can be filtered on. */
export const OUTBOUND_DOC_FILTER_FIELDS = [
  'material_code',
  'material_name',
  'warehouse_name',
  // SO: the customer; TO: the destination warehouse.
  'customer_name',
  'tran_id',
  // WMS's outbound number ("SO ID").
  'outbound_id',
  'picking_code',
  'packing_code',
  'delivery_code',
  'created_by_name',
] as const;
export type OutboundDocFilterField = (typeof OUTBOUND_DOC_FILTER_FIELDS)[number];

export class OutboundDocFilterDto {
  @IsIn(OUTBOUND_DOC_FILTER_FIELDS)
  field!: OutboundDocFilterField;

  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 values per filter' })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}

/** The query of the Picking / Packing lists (and Outbound History). */
export class QueryOutboundDocDto extends SortableQueryDto {
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

  // SALES_ORDER | TRANSFER_ORDER — filters the list by source.
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsIn(['Open', 'OnProgress', 'Closed'])
  status?: 'Open' | 'OnProgress' | 'Closed';

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
    return plainToInstance(OutboundDocFilterDto, raw);
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  filters?: OutboundDocFilterDto[];

  /** "true" adds each document's lines, for the list's accordion. */
  @IsOptional()
  @IsIn(['true', 'false'])
  include_items?: string;
}

export class QueryPickingDto extends QueryOutboundDocDto {}
