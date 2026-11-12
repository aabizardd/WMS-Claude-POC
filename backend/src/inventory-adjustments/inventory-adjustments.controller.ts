import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { ApproveInventoryAdjustmentDto } from './dto/approve-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from './dto/query-inventory-adjustment.dto';
import { QueryAdjustmentItemsDto } from './dto/query-adjustment-items.dto';
import { iaExportFileName, writeIaXlsx } from './ia-export';
import { xlsxHeaders } from '../common/xlsx-export';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('inventory-adjustments')
export class InventoryAdjustmentsController {
  constructor(private readonly service: InventoryAdjustmentsService) {}

  // ---- create-form lookups (declared before ':id') ----

  /** The IA type behaviour matrix (PRD-06), so the UI mirrors the server rules. */
  @Get('types')
  @RequirePermissions('inventory-adjustments:read')
  types() {
    return this.service.types();
  }

  /** Create-form defaults (the user's department). */
  @Get('defaults')
  @RequirePermissions('inventory-adjustments:create')
  defaults(@CurrentUser() user: AuthUser) {
    return this.service.defaults(user);
  }

  @Get('materials')
  @RequirePermissions('inventory-adjustments:create')
  materialOptions(
    @Query('adjustment_type') type: string,
    @Query('search') search: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.materialOptions(type, user, {
      search,
      page: Number(page) || undefined,
      limit: Number(limit) || undefined,
    });
  }

  @Get('bins')
  @RequirePermissions('inventory-adjustments:create')
  binOptions(
    @Query('material_id') materialId: string,
    @Query('adjustment_type') type: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.binOptions(materialId, type, user);
  }

  /** FR-IA-10: discrepancy references for the picked materials. */
  @Get('discrepancies')
  @RequirePermissions('inventory-adjustments:create')
  discrepancyOptions(
    @Query('adjustment_type') type: string,
    @Query('material_ids') materialIds: string,
    @Query('bin_ids') binIds: string,
    @CurrentUser() user: AuthUser,
  ) {
    const split = (v: string) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return this.service.discrepancyOptions(type, split(materialIds), split(binIds), user);
  }

  @Get()
  @RequirePermissions('inventory-adjustments:read')
  findAll(
    @Query() query: QueryInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(query, user);
  }

  /** The list as one flat Excel sheet, with the same filters and sort. */
  @Get('export')
  @RequirePermissions('inventory-adjustments:read')
  async export(
    @Query() query: QueryInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    res.set(xlsxHeaders(iaExportFileName()));
    await writeIaXlsx(this.service.exportRows(query, user), res);
  }

  /** The export confirmation's numbers: documents and rows, filtered and all. */
  @Get('export/summary')
  @RequirePermissions('inventory-adjustments:read')
  exportSummary(@Query() query: QueryInventoryAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.service.exportSummary(query, user);
  }

  /** One page of the document's lines: searched, filtered, sorted and paged server-side. */
  @Get(':id/items')
  @RequirePermissions('inventory-adjustments:read')
  findItems(
    @Param('id') id: string,
    @Query() query: QueryAdjustmentItemsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findItems(id, query, user);
  }

  @Get(':id')
  @RequirePermissions('inventory-adjustments:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('inventory-adjustments:create')
  create(
    @Body() dto: CreateInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user);
  }

  // ---- approval & Oracle ----

  /** Approve/reject (WH Manager). Only while Waiting Approval. */
  @Put(':id/approve')
  @RequirePermissions('inventory-adjustments:approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveInventoryAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approve(id, dto, user);
  }

  /** FR-IA-16 rule 3: resend an approved document whose Oracle post failed. */
  @Put(':id/send-oracle')
  @RequirePermissions('inventory-adjustments:approve')
  sendOracle(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.sendToOracle(id, user);
  }

  /** The list's refresh: read the Oracle decision of every document waiting for it. */
  @Post('check-oracle')
  @RequirePermissions('inventory-adjustments:read')
  checkOracleAll(@CurrentUser() user: AuthUser) {
    return this.service.checkOracleAll(user);
  }

  /** FR-IA-13: read the Oracle decision and settle the document. */
  @Put(':id/check-oracle')
  @RequirePermissions('inventory-adjustments:read')
  checkOracle(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.checkOracle(id, user);
  }
}
