import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

// What a signed-in user may change about themselves. Role, warehouse and
// status stay with the User Master.
export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsEmail()
  email!: string;

  // Empty string clears it.
  @IsOptional()
  @IsString()
  employeeId?: string;

  // Leave both empty to keep the current password.
  @IsOptional()
  @IsString()
  @MinLength(6)
  newPassword?: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;
}
