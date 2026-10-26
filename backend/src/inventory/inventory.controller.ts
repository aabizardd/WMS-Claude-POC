import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { AdjustBinsDto } from './dto/adjust-bins.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  @RequirePermissions('inventory:read')
  findAll(@Query() query: QueryInventoryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('inventory:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  /** SO / TO documents behind the header Reserved or In Transit Qty. */
  @Get(':id/qty-sources/:type')
  @RequirePermissions('inventory:read')
  qtySources(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.qtySources(id, type, user);
  }

  /** Manual bin re-allocations, newest first. */
  @Get(':id/transfers')
  @RequirePermissions('inventory:read')
  transferHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.transferHistory(id, user);
  }

  @Patch(':id/bins')
  @RequirePermissions('inventory:update')
  adjustBins(
    @Param('id') id: string,
    @Body() dto: AdjustBinsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.adjustBins(id, dto, user);
  }
}
