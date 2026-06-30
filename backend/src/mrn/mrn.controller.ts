import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MrnService } from './mrn.service';
import { MrnSyncService } from './mrn-sync.service';
import { QueryMrnDto } from './dto/query-mrn.dto';
import { SyncMrnDto } from './dto/sync-mrn.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('mrn')
export class MrnController {
  constructor(
    private readonly service: MrnService,
    private readonly sync: MrnSyncService,
  ) {}

  // Pull inbound shipments (PIB, inTransit) from Oracle into MRN.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('mrn:sync')
  syncErp(@Body() dto: SyncMrnDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('mrn:read')
  findAll(@Query() query: QueryMrnDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('erp-last-sync')
  @RequirePermissions('mrn:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  @Get(':id')
  @RequirePermissions('mrn:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
