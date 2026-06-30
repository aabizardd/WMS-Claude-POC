import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateShelfDto {
  @IsString()
  @IsNotEmpty()
  shelfLabel!: string;

  @IsString()
  @IsNotEmpty()
  shelfCode!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
