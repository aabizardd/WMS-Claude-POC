import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { WarehouseSyncService } from './warehouse-sync.service';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { SyncWarehouseDto } from './dto/sync-warehouse.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('warehouses')
export class WarehousesController {
  constructor(
    private readonly service: WarehousesService,
    private readonly sync: WarehouseSyncService,
  ) {}

  // Pull warehouses (Oracle locations) and upsert them.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('warehouses:sync')
  syncErp(@Body() dto: SyncWarehouseDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('warehouses:read')
  findAll(@Query() query: QueryWarehouseDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user.
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('erp-last-sync')
  @RequirePermissions('warehouses:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }
}
