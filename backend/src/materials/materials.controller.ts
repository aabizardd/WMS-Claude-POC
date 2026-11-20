import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { xlsxHeaders, wibParts } from '../common/xlsx-export';
import { MaterialDimensionImportService } from './material-dimension-import.service';
import { DIMENSION_IMPORT_MAX_BYTES } from './material-dimension-import';
import { ApplyDimensionImportDto } from './dto/apply-dimension-import.dto';
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
    private readonly dimensionImport: MaterialDimensionImportService,
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

  /**
   * Import Dimensions: the template — the materials matching the list's search
   * (all when empty) with their current dimensions, to edit and upload back.
   */
  @Get('dimension-import/template')
  @RequirePermissions('materials:update')
  async dimensionTemplate(@Query('search') search: string | undefined, @Res() res: Response) {
    const t = wibParts(new Date());
    res.set(xlsxHeaders(`material_dimensions_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`));
    await this.dimensionImport.template(search, res);
  }

  /** Import Dimensions: check an uploaded workbook (not stored, nothing written). */
  @Post('dimension-import/preview')
  @HttpCode(200)
  @RequirePermissions('materials:update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DIMENSION_IMPORT_MAX_BYTES } }))
  dimensionPreview(@UploadedFile() file: { buffer: Buffer; originalname: string } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an .xlsx file to import');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx files can be imported');
    return this.dimensionImport.preview(file.buffer);
  }

  /** Import Dimensions: save the preview's checked changes. */
  @Post('dimension-import/apply')
  @HttpCode(200)
  @RequirePermissions('materials:update')
  dimensionApply(@Body() dto: ApplyDimensionImportDto, @CurrentUser('username') username: string) {
    return this.dimensionImport.apply(dto, username);
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
