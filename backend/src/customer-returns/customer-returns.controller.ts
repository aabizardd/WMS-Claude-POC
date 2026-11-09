import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { xlsxHeaders } from '../common/xlsx-export';
import { requestGrExportFileName, writeRequestGrXlsx } from '../common/request-gr-export';
import { CustomerReturnsService } from './customer-returns.service';
import { CustomerReturnSyncService } from './customer-return-sync.service';
import { QueryCustomerReturnDto } from './dto/query-customer-return.dto';
import { SyncCustomerReturnDto } from './dto/sync-customer-return.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('customer-returns')
export class CustomerReturnsController {
  constructor(
    private readonly service: CustomerReturnsService,
    private readonly sync: CustomerReturnSyncService,
  ) {}

  // Pull Customer Returns (every status) from Oracle into WMS.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('customer-returns:sync')
  syncErp(@Body() dto: SyncCustomerReturnDto) {
    return this.sync.sync({ lastModified: dto.lastModified, pageSize: dto.pageSize });
  }

  // Refresh ONE return (header + lines) from Oracle by its Oracle id.
  @Post(':oracleId/refresh')
  @HttpCode(200)
  @RequirePermissions('customer-returns:sync')
  async refreshOne(@Param('oracleId') oracleId: string) {
    return { refreshed: await this.sync.syncOne(oracleId) };
  }

  @Get()
  @RequirePermissions('customer-returns:read')
  findAll(@Query() query: QueryCustomerReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('erp-last-sync')
  @RequirePermissions('customer-returns:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  /**
   * The Request list as an Excel file, down to its Goods Receives: one sheet,
   * one row per line and GR line (GR columns empty when none was made yet),
   * for whatever the list is filtered and sorted by. Declared before ':id'.
   */
  @Get('export')
  @RequirePermissions('customer-returns:read')
  async exportXlsx(@Query() query: QueryCustomerReturnDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(requestGrExportFileName('CR')));
    await writeRequestGrXlsx('CR', this.service.exportRows(query, user), res);
  }

  /** The export confirmation's numbers (filtered and all), without building the file. */
  @Get('export/summary')
  @RequirePermissions('customer-returns:read')
  exportSummary(@Query() query: QueryCustomerReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.exportSummary(query, user);
  }

  @Get(':id')
  @RequirePermissions('customer-returns:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
