import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

// All fields optional on update; password optional too (only changed when provided)
export class UpdateUserDto extends PartialType(CreateUserDto) {}
