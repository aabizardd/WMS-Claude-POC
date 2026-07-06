import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class GeneratePackingDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  pickingIds!: string[];
}
