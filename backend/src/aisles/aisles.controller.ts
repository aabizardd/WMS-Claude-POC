import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { AislesService } from './aisles.service';
import { CreateAisleDto } from './dto/create-aisle.dto';
import { UpdateAisleDto } from './dto/update-aisle.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('aisles')
export class AislesController {
  constructor(private readonly service: AislesService) {}

  @Get()
  @RequirePermissions('aisles:read')
  findAll() {
    return this.service.findAll();
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get(':id')
  @RequirePermissions('aisles:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('aisles:create')
  create(@Body() dto: CreateAisleDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('aisles:update')
  update(@Param('id') id: string, @Body() dto: UpdateAisleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('aisles:delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
