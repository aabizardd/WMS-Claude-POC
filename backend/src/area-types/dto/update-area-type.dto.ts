import { PartialType } from '@nestjs/mapped-types';
import { CreateAreaTypeDto } from './create-area-type.dto';

export class UpdateAreaTypeDto extends PartialType(CreateAreaTypeDto) {}
