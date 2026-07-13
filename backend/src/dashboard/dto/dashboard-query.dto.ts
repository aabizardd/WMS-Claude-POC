import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

// Selectable dashboard window (days). Allowlisted to keep queries bounded.
export class DashboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  range?: number = 30;
}
