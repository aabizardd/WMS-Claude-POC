import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAisleDto {
  @IsString()
  @IsNotEmpty()
  aisleName!: string;

  @IsString()
  @IsNotEmpty()
  aisleCode!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
