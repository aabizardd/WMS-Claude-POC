import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class GenerateDeliveryDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  packingIds!: string[];
}
