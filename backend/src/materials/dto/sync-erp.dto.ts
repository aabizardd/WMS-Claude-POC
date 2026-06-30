import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncErpDto {
  // Omit for a full sync of all items.
  // Provide an ISO datetime (e.g. "2024-06-25T09:04:00+07:00") for an
  // incremental sync — maps to filters.lastmodified on the ERP request.
  @IsOptional()
  @IsISO8601()
  lastModified?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
