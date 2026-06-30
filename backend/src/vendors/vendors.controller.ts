import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorSyncService } from './vendor-sync.service';
import { QueryVendorDto } from './dto/query-vendor.dto';
import { SyncVendorDto } from './dto/sync-vendor.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly service: VendorsService,
    private readonly sync: VendorSyncService,
  ) {}

  // Pull vendors from Oracle and upsert them.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('vendors:sync')
  syncErp(@Body() dto: SyncVendorDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('vendors:read')
  findAll(@Query() query: QueryVendorDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user.
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('erp-last-sync')
  @RequirePermissions('vendors:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }
}
