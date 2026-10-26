import { IsArray, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class PutawayItemDto {
  // Exactly one of these: an MRN item (PIB) or a Goods Receive item (TO).
  mrnItemId?: string;
  grItemId?: string;

  @IsNumber()
  plannedQty!: number;

  // Destination bin, chosen when the putaway is generated (as on WMS dev).
  @IsString()
  binId!: string;

  @IsOptional()
  @IsInt()
  pickerId?: number;
}

export class GeneratePutawayDto {
  @IsArray()
  items!: PutawayItemDto[];
}
