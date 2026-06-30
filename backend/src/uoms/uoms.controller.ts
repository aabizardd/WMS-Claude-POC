import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { UomsService } from './uoms.service';
import { CreateUomDto } from './dto/create-uom.dto';
import { UpdateUomDto } from './dto/update-uom.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('uoms')
export class UomsController {
  constructor(private readonly uomsService: UomsService) {}

  @Get()
  @RequirePermissions('uoms:read')
  findAll() {
    return this.uomsService.findAll();
  }

  // Lookup for dropdowns — any authenticated user (declared before ':id').
  @Get('options')
  options() {
    return this.uomsService.options();
  }

  @Get(':id')
  @RequirePermissions('uoms:read')
  findOne(@Param('id') id: string) {
    return this.uomsService.findOne(id);
  }

  @Post()
  @RequirePermissions('uoms:create')
  create(@Body() dto: CreateUomDto) {
    return this.uomsService.create(dto);
  }

  @Put(':id')
  @RequirePermissions('uoms:update')
  update(@Param('id') id: string, @Body() dto: UpdateUomDto) {
    return this.uomsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('uoms:delete')
  remove(@Param('id') id: string) {
    return this.uomsService.remove(id);
  }
}
