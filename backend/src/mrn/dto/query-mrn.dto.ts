import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SortableQueryDto } from '../../common/dto/sortable-query.dto';

export class QueryMrnDto extends SortableQueryDto {
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

  // Nomor Aju (customs registration number), matched as "contains".
  @IsOptional()
  @IsString()
  @MaxLength(100)
  aju_no?: string;
}
