import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
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
}
