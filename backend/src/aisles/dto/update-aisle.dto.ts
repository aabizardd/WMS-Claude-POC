import { PartialType } from '@nestjs/mapped-types';
import { CreateAisleDto } from './create-aisle.dto';

export class UpdateAisleDto extends PartialType(CreateAisleDto) {}
