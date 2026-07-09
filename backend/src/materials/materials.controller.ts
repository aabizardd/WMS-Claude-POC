import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { ErpSyncService } from './erp-sync.service';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { QueryMaterialDto } from './dto/query-material.dto';
import { SyncErpDto } from './dto/sync-erp.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('materials')
export class MaterialsController {
  constructor(
    private readonly service: MaterialsService,
    private readonly erpSync: ErpSyncService,
  ) {}

  // Pull items from the Oracle/ERP bridge and upsert them.
  // Body: { lastModified?: ISO datetime, pageSize?: number }
  // Omit lastModified for a full sync of all items.
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('materials:sync')
  syncErp(@Body() dto: SyncErpDto) {
    return this.erpSync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
      // Manual "Sync from ERP" also upserts per-location qty_available (the
      // background scheduler still skips it).
      syncAvailability: true,
    });
  }

  @Get()
  @RequirePermissions('materials:read')
  findAll(@Query() query: QueryMaterialDto) {
    return this.service.findAll(query);
  }

  // Last sync timestamp (max created_at of ERP-synced materials).
  // Declared before ':id' so it isn't captured as an id param.
  @Get('erp-last-sync')
  @RequirePermissions('materials:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  @Get(':id')
  @RequirePermissions('materials:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Only editing is allowed in WMS (no create/delete). ERP-synced materials
  // keep their Oracle-owned code & name; other fields are editable.
  @Put(':id')
  @RequirePermissions('materials:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMaterialDto,
    @CurrentUser('username') username: string,
  ) {
    return this.service.update(id, dto, username);
  }
}
