import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TransferOrdersService } from './transfer-orders.service';
import { TransferOrderSyncService } from './transfer-order-sync.service';
import { QueryTransferOrderDto } from './dto/query-transfer-order.dto';
import { SyncTransferOrderDto } from './dto/sync-transfer-order.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { transferOrderExportFileName, writeTransferOrderXlsx } from './transfer-order-export';
import { xlsxHeaders } from '../common/xlsx-export';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('transfer-orders')
export class TransferOrdersController {
  constructor(
    private readonly service: TransferOrdersService,
    private readonly sync: TransferOrderSyncService,
  ) {}

  // Pull transfer orders from Oracle into WMS (all statuses).
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('transfer-orders:sync')
  syncErp(@Body() dto: SyncTransferOrderDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  /**
   * The TO Out (direction=out) or TO In (direction=in) list as an Excel file,
   * for whatever it is filtered and sorted by. Both come out in the same
   * "ITI TO" layout: they are the same Transfer Orders.
   */
  @Get('export')
  @RequirePermissions('transfer-orders:read')
  async export(@Query() query: QueryTransferOrderDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(transferOrderExportFileName()));
    await writeTransferOrderXlsx(this.service.exportRows(query, user), res);
  }

  @Get()
  @RequirePermissions('transfer-orders:read')
  findAll(@Query() query: QueryTransferOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('statuses')
  @RequirePermissions('transfer-orders:read')
  statuses(@CurrentUser() user: AuthUser) {
    return this.service.getStatuses(user);
  }

  @Get('erp-last-sync')
  @RequirePermissions('transfer-orders:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  /** A TO seen from its destination warehouse (Inbound from Transfer Stock). */
  @Get('inbound/:id')
  @RequirePermissions('transfer-orders:read')
  findOneInbound(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOneInbound(id, user);
  }

  @Get(':id')
  @RequirePermissions('transfer-orders:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
