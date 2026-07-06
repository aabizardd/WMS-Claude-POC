import { IsArray, IsInt, IsNumber, IsOptional } from 'class-validator';

export class PutawayItemDto {
  mrnItemId!: string;

  @IsNumber()
  plannedQty!: number;

  @IsOptional()
  @IsInt()
  pickerId?: number;
}

export class GeneratePutawayDto {
  @IsArray()
  items!: PutawayItemDto[];
}
