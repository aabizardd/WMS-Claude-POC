import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { ClassesService } from './classes.service';
import { ClassSyncService } from './class-sync.service';
import { QueryClassDto } from './dto/query-class.dto';
import { SyncClassDto } from './dto/sync-class.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('classes')
export class ClassesController {
  constructor(
    private readonly service: ClassesService,
    private readonly sync: ClassSyncService,
  ) {}

  // Pull classes from Oracle and upsert them.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('classes:sync')
  syncErp(@Body() dto: SyncClassDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('classes:read')
  findAll(@Query() query: QueryClassDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user.
  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('erp-last-sync')
  @RequirePermissions('classes:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }
}
