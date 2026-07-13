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
import { MaterialCategoriesService } from './material-categories.service';
import { CreateMaterialCategoryDto } from './dto/create-material-category.dto';
import { UpdateMaterialCategoryDto } from './dto/update-material-category.dto';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('material-categories')
export class MaterialCategoriesController {
  constructor(private readonly service: MaterialCategoriesService) {}

  @Get()
  @RequirePermissions('material-categories:read')
  findAll(@Query() query: PaginatedQueryDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user (declared before ':id').
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get(':id')
  @RequirePermissions('material-categories:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('material-categories:create')
  create(@Body() dto: CreateMaterialCategoryDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('material-categories:update')
  update(@Param('id') id: string, @Body() dto: UpdateMaterialCategoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('material-categories:delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
