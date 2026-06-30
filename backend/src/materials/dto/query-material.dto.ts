import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryMaterialDto {
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

  // free-text search across material name & code
  @IsOptional()
  @IsString()
  search?: string;

  // e.g. "created_at desc" | "material_name asc"
  @IsOptional()
  @IsString()
  order_by?: string = 'created_at desc';
}
