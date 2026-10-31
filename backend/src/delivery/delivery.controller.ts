import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { xlsxHeaders } from '../common/xlsx-export';
import { soDeliveryExportFileName } from '../sales-orders/so-delivery-export';
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
   * Delivery Plan export: the shipped Sales Order plans the list's filters
   * match, with their SO lines. Declared before ':id'.
   */
  @Get('export')
  @RequirePermissions('delivery:read')
  async exportXlsx(@Query() query: QueryDeliveryDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(soDeliveryExportFileName('dp')));
    await this.service.exportXlsx(query, user, res);
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
