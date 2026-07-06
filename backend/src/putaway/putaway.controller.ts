import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { GeneratePutawayDto } from './dto/generate-putaway.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('putaway')
export class PutawayController {
  constructor(private readonly service: PutawayService) {}

  @Get()
  @RequirePermissions('putaway:read')
  findAll(
    @Query()
    query: { page?: number; limit?: number; search?: string; history?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('putaway:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('putaway:create')
  generate(@Body() dto: GeneratePutawayDto) {
    return this.service.generate(dto);
  }

  @Put(':id/assign')
  @RequirePermissions('putaway:update')
  assignPicker(
    @Param('id') id: string,
    @Body() dto: { items: { id: string; pickerId: number | null }[] },
  ) {
    return this.service.assignPicker(id, dto.items);
  }

  @Put(':id/confirm')
  @RequirePermissions('putaway:update')
  confirm(
    @Param('id') id: string,
    @Body() dto: { items: { id: string; actualQty: number; qualityIssue: number; qtyIssue: number; binId: string | null }[] },
  ) {
    return this.service.confirm(id, dto.items);
  }
}
