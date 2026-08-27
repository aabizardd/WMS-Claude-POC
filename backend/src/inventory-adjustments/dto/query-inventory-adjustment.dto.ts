import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';
import { IA_TYPES } from '../ia-rules';

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
}
