import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ShelvesService } from './shelves.service';
import { CreateShelfDto } from './dto/create-shelf.dto';
import { UpdateShelfDto } from './dto/update-shelf.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('shelves')
export class ShelvesController {
  constructor(private readonly service: ShelvesService) {}

  @Get()
  @RequirePermissions('shelves:read')
  findAll() {
    return this.service.findAll();
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get(':id')
  @RequirePermissions('shelves:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('shelves:create')
  create(@Body() dto: CreateShelfDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('shelves:update')
  update(@Param('id') id: string, @Body() dto: UpdateShelfDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('shelves:delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
