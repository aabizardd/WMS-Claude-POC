import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** One page of the materials a sending warehouse can transfer out. */
export class QueryToStockItemsDto {
  @IsUUID()
  warehouse_id!: string;

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

  // Material code or name.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
