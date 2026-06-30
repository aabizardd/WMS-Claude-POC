import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateUomDto {
  @IsString()
  @IsNotEmpty()
  uomName!: string;

  @IsString()
  @IsNotEmpty()
  uomCode!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
