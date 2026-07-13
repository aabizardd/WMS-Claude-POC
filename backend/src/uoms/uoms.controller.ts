import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UomsService } from './uoms.service';
import { CreateUomDto } from './dto/create-uom.dto';
import { UpdateUomDto } from './dto/update-uom.dto';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('uoms')
export class UomsController {
  constructor(private readonly uomsService: UomsService) {}

  @Get()
  @RequirePermissions('uoms:read')
  findAll(@Query() query: PaginatedQueryDto) {
    return this.uomsService.findAll(query);
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
