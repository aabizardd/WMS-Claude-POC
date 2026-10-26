import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SalesDeliveryService } from './sales-delivery.service';
import { CreateSalesDeliveryDto } from './dto/create-sales-delivery.dto';
import { QuerySalesDeliveryDto } from './dto/query-sales-delivery.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('sales-delivery')
export class SalesDeliveryController {
  constructor(private readonly service: SalesDeliveryService) {}

  // ---- create-form lookups (declared before ':id') ----

  /** Header defaults and dropdowns: From Location, To Location, department, class. */
  @Get('form-options')
  @RequirePermissions('sales-delivery:create')
  formOptions(@CurrentUser() user: AuthUser) {
    return this.service.formOptions(user);
  }

  /** Materials with available stock in the From Location picked on the form. */
  @Get('materials')
  @RequirePermissions('sales-delivery:create')
  materialOptions(@Query('from_warehouse_id') fromWarehouseId: string) {
    return this.service.materialOptions(fromWarehouseId);
  }

  @Get('bins')
  @RequirePermissions('sales-delivery:create')
  binOptions(
    @Query('material_id') materialId: string,
    @Query('from_warehouse_id') fromWarehouseId: string,
  ) {
    return this.service.binOptions(materialId, fromWarehouseId);
  }

  /** Bins of the To Location holding a material — used by a Sales Return. */
  @Get('return-bins')
  @RequirePermissions('sales-delivery:create')
  returnBinOptions(
    @Query('material_id') materialId: string,
    @Query('to_warehouse_id') toWarehouseId: string,
  ) {
    return this.service.returnBinOptions(materialId, toWarehouseId);
  }

  /** Dropdown values (master warehouses and users) for the tracking filters. */
  @Get('tracking-options')
  @RequirePermissions('sales-delivery:read')
  trackingOptions() {
    return this.service.trackingFilterOptions();
  }

  /** Deliveries a Sales Return can be copied from. */
  @Get('return-sources')
  @RequirePermissions('sales-delivery:create')
  returnSources(
    @Query('search') search: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.returnSourceOptions(search, user);
  }

  @Get()
  @RequirePermissions('sales-delivery:read')
  findAll(
    @Query() query: QuerySalesDeliveryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('sales-delivery:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('sales-delivery:create')
  create(
    @Body() dto: CreateSalesDeliveryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user);
  }
}
