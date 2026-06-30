import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { AreaTypesService } from './area-types.service';
import { CreateAreaTypeDto } from './dto/create-area-type.dto';
import { UpdateAreaTypeDto } from './dto/update-area-type.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('area-types')
export class AreaTypesController {
  constructor(private readonly service: AreaTypesService) {}

  @Get()
  @RequirePermissions('area-types:read')
  findAll() {
    return this.service.findAll();
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get(':id')
  @RequirePermissions('area-types:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('area-types:create')
  create(@Body() dto: CreateAreaTypeDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('area-types:update')
  update(@Param('id') id: string, @Body() dto: UpdateAreaTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('area-types:delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
