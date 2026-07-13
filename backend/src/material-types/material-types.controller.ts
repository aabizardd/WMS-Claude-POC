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
import { MaterialTypesService } from './material-types.service';
import { CreateMaterialTypeDto } from './dto/create-material-type.dto';
import { UpdateMaterialTypeDto } from './dto/update-material-type.dto';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('material-types')
export class MaterialTypesController {
  constructor(private readonly service: MaterialTypesService) {}

  @Get()
  @RequirePermissions('material-types:read')
  findAll(@Query() query: PaginatedQueryDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user (declared before ':id').
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get(':id')
  @RequirePermissions('material-types:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('material-types:create')
  create(@Body() dto: CreateMaterialTypeDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('material-types:update')
  update(@Param('id') id: string, @Body() dto: UpdateMaterialTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('material-types:delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
