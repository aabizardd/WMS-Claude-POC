import { IsIn, IsOptional, IsString } from 'class-validator';

// Shared server-side sorting params for paginated list endpoints.
// sort_by = snake_case column key (allowlisted per service); sort_order = asc|desc.
export class SortableQueryDto {
  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
