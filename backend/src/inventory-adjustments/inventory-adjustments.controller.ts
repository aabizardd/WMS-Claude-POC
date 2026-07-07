import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { ApproveInventoryAdjustmentDto } from './dto/approve-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from './dto/query-inventory-adjustment.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('inventory-adjustments')
export class InventoryAdjustmentsController {
  constructor(private readonly service: InventoryAdjustmentsService) {}

  // ---- create-form lookups (declared before ':id') ----

  @Get('materials')
  @RequirePermissions('inventory-adjustments:create')
  materialOptions(@CurrentUser() user: AuthUser) {
    return this.service.materialOptions(user);
  }

  @Get('bins')
  @RequirePermissions('inventory-adjustments:create')
  binOptions(
    @Query('material_id') materialId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.binOptions(materialId, user);
  }

  @Get()
  @RequirePermissions('inventory-adjustments:read')
  findAll(
    @Query() query: QueryInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('inventory-adjustments:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('inventory-adjustments:create')
  create(
    @Body() dto: CreateInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user);
  }

  // Approve/reject (WH Manager). Only allowed while Pending Approval.
  @Put(':id/approve')
  @RequirePermissions('inventory-adjustments:approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approve(id, dto, user);
  }
}
