import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PackingService } from './packing.service';
import { GeneratePackingDto } from './dto/generate-packing.dto';
import { QueryPackingDto } from './dto/query-packing.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('packing')
export class PackingController {
  constructor(private readonly service: PackingService) {}

  @Get()
  @RequirePermissions('packing:read')
  findAll(@Query() query: QueryPackingDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  // Closed pickings that can still be packed (for the Generate Packing modal).
  @Get('available-pickings')
  @RequirePermissions('packing:create')
  availablePickings(@CurrentUser() user: AuthUser) {
    return this.service.availablePickings(user);
  }

  @Get(':id')
  @RequirePermissions('packing:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('packing:create')
  generate(@Body() dto: GeneratePackingDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }
}
