import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAreaTypeDto {
  @IsString()
  @IsNotEmpty()
  areaTypeName!: string;

  @IsString()
  @IsNotEmpty()
  areaTypeCode!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
