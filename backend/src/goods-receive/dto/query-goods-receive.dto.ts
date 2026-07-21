import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

export class QueryGoodsReceiveDto extends SortableQueryDto {
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

  // Source filter: PIB (Inbound from PIB tab) vs PO (Local Vendor tab).
  // Omitted → all sources.
  @IsOptional()
  @IsIn(['PIB', 'PO', 'CUSTOMER_RETURN', 'TRANSFER_RETURN'])
  source?: string;
}
