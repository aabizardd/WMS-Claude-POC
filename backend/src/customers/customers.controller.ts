import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerSyncService } from './customer-sync.service';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { SyncCustomerDto } from './dto/sync-customer.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly service: CustomersService,
    private readonly sync: CustomerSyncService,
  ) {}

  // Pull customers from Oracle and upsert them.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('customers:sync')
  syncErp(@Body() dto: SyncCustomerDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('customers:read')
  findAll(@Query() query: QueryCustomerDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user.
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('erp-last-sync')
  @RequirePermissions('customers:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }
}
