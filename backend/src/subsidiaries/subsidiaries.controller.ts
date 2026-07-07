import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { SubsidiariesService } from './subsidiaries.service';
import { SubsidiarySyncService } from './subsidiary-sync.service';
import { QuerySubsidiaryDto } from './dto/query-subsidiary.dto';
import { SyncSubsidiaryDto } from './dto/sync-subsidiary.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('subsidiaries')
export class SubsidiariesController {
  constructor(
    private readonly service: SubsidiariesService,
    private readonly sync: SubsidiarySyncService,
  ) {}

  // Pull subsidiaries from Oracle and upsert them.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('subsidiaries:sync')
  syncErp(@Body() dto: SyncSubsidiaryDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('subsidiaries:read')
  findAll(@Query() query: QuerySubsidiaryDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user.
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('erp-last-sync')
  @RequirePermissions('subsidiaries:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }
}
