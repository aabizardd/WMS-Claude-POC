import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrderSyncService } from './sales-order-sync.service';
import { QuerySalesOrderDto } from './dto/query-sales-order.dto';
import { SyncSalesOrderDto } from './dto/sync-sales-order.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly service: SalesOrdersService,
    private readonly sync: SalesOrderSyncService,
  ) {}

  // Pull sales orders (status Pending Fulfillment) from Oracle into WMS.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('sales-orders:sync')
  syncErp(@Body() dto: SyncSalesOrderDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('sales-orders:read')
  findAll(@Query() query: QuerySalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('statuses')
  @RequirePermissions('sales-orders:read')
  statuses(@CurrentUser() user: AuthUser) {
    return this.service.getStatuses(user);
  }

  @Get('erp-last-sync')
  @RequirePermissions('sales-orders:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  @Get(':id')
  @RequirePermissions('sales-orders:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
