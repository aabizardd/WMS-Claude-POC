import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

export const OWNERSHIP_TYPES = ['Vendor', 'Customer'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export class QueryOwnershipDto extends SortableQueryDto {
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

  // Omitted = both vendors and customers.
  @IsOptional()
  @IsIn(OWNERSHIP_TYPES)
  type?: OwnershipType;
}
