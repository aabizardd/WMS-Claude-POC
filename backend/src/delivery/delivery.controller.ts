import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { xlsxHeaders } from '../common/xlsx-export';
import { soDeliveryExportFileName } from '../sales-orders/so-delivery-export';
import { transferOrderExportFileName } from '../transfer-orders/transfer-order-export';
import { DeliveryService } from './delivery.service';
import { GenerateDeliveryDto } from './dto/generate-delivery.dto';
import { QueryDeliveryDto } from './dto/query-delivery.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get()
  @RequirePermissions('delivery:read')
  findAll(@Query() query: QueryDeliveryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  /**
   * Delivery Plan export: the plans of the list's source (SO or TO) its
   * filters match (Open or Closed), with their order lines. Declared before ':id'.
   */
  @Get('export')
  @RequirePermissions('delivery:read')
  async exportXlsx(@Query() query: QueryDeliveryDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(soDeliveryExportFileName(query.source === 'TRANSFER_ORDER' ? 'to-dp' : 'dp')));
    await this.service.exportXlsx(query, user, res);
  }

  /**
   * TO Delivery Plan, Export SD: the Transfer Order export's "ITI TO" file,
   * holding only the SD lines (shipped TO deliveries) its filters match.
   */
  @Get('export-sd')
  @RequirePermissions('delivery:read')
  async exportSd(@Query() query: QueryDeliveryDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(transferOrderExportFileName(new Date(), 'sd')));
    await this.service.exportSdXlsx(query, user, res);
  }

  /** Export SD's confirmation numbers (SDs and rows), filtered and all. */
  @Get('export-sd/summary')
  @RequirePermissions('delivery:read')
  exportSdSummary(@Query() query: QueryDeliveryDto, @CurrentUser() user: AuthUser) {
    return this.service.exportSdSummary(query, user);
  }

  /** Dropdown values (master warehouses, customers, users) for SD Tracking. */
  @Get('tracking-options')
  @RequirePermissions('delivery:read')
  trackingOptions() {
    return this.service.trackingOptions();
  }

  @Get(':id')
  @RequirePermissions('delivery:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('delivery:create')
  generate(@Body() dto: GenerateDeliveryDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  // Generate Shipment: create the SDO ID and close the delivery.
  @Put(':id/generate-shipment')
  @RequirePermissions('delivery:update')
  generateShipment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.generateShipment(id, user);
  }

  // Delete an Open delivery plan; its packings reopen (packed again).
  @Delete(':id')
  @RequirePermissions('delivery:delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
