import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderSyncService } from './purchase-order-sync.service';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { SyncPurchaseOrderDto } from './dto/sync-purchase-order.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly service: PurchaseOrdersService,
    private readonly sync: PurchaseOrderSyncService,
  ) {}

  // Pull receivable (pendingReceipt) purchase orders from Oracle into WMS.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('purchase-orders:sync')
  syncErp(@Body() dto: SyncPurchaseOrderDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  // Refresh ONE PO (header + lines) from Oracle by its Oracle id — receipts
  // change line qty without bumping lastmodified, so incremental sync misses it.
  @Post(':oracleId/refresh')
  @HttpCode(200)
  @RequirePermissions('purchase-orders:sync')
  async refreshOne(@Param('oracleId') oracleId: string) {
    const refreshed = await this.sync.syncOne(oracleId);
    return { refreshed };
  }

  @Get()
  @RequirePermissions('purchase-orders:read')
  findAll(@Query() query: QueryPurchaseOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('statuses')
  @RequirePermissions('purchase-orders:read')
  statuses(@CurrentUser() user: AuthUser) {
    return this.service.getStatuses(user);
  }

  @Get('erp-last-sync')
  @RequirePermissions('purchase-orders:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  @Get(':id')
  @RequirePermissions('purchase-orders:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
