import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsInt()
  roleId!: number;

  // Required single warehouse for the user.
  @IsUUID()
  warehouseId!: string;

  // Optional org assignment. Subsidiary requires a department and must belong
  // to it (validated in the service).
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsUUID()
  subsidiaryId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
