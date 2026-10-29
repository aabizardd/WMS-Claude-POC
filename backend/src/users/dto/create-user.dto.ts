import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
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

  // Empty string clears it.
  @IsOptional()
  @IsString()
  employeeId?: string | null;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsInt()
  roleId!: number;

  // The warehouses the user works in (at least one, as on WMS dev).
  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one warehouse' })
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  warehouseIds!: string[];

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
