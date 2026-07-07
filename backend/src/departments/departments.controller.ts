import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentSyncService } from './department-sync.service';
import { QueryDepartmentDto } from './dto/query-department.dto';
import { SyncDepartmentDto } from './dto/sync-department.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly service: DepartmentsService,
    private readonly sync: DepartmentSyncService,
  ) {}

  // Pull departments from Oracle and upsert them.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('departments:sync')
  syncErp(@Body() dto: SyncDepartmentDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  @Get()
  @RequirePermissions('departments:read')
  findAll(@Query() query: QueryDepartmentDto) {
    return this.service.findAll(query);
  }

  // Lookup for dropdowns — any authenticated user.
  @Get('options')
  options() {
    return this.service.options();
  }

  // Subsidiaries belonging to a department — for the dependent User form select.
  @Get(':id/subsidiaries')
  subsidiaryOptions(@Param('id') id: string) {
    return this.service.subsidiaryOptions(id);
  }

  @Get('erp-last-sync')
  @RequirePermissions('departments:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }
}
