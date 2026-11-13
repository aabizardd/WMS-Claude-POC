import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { TransferOrdersService } from './transfer-orders.service';
import { TransferOrderSyncService } from './transfer-order-sync.service';
import { TransferOrderCreateService } from './transfer-order-create.service';
import { CreateTransferOrderDto } from './dto/create-transfer-order.dto';
import { ResolveToItemsDto } from './dto/resolve-to-items.dto';
import { QueryToStockItemsDto } from './dto/query-to-stock-items.dto';
import { QueryTransferOrderDto } from './dto/query-transfer-order.dto';
import { SyncTransferOrderDto } from './dto/sync-transfer-order.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { transferOrderExportFileName, writeTransferOrderXlsx } from './transfer-order-export';
import { xlsxHeaders } from '../common/xlsx-export';
import { parseToImport, writeToImportTemplate } from './to-import';

/** The largest workbook Import Excel accepts. */
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('transfer-orders')
export class TransferOrdersController {
  constructor(
    private readonly service: TransferOrdersService,
    private readonly sync: TransferOrderSyncService,
    private readonly creator: TransferOrderCreateService,
  ) {}

  /** Create TO form: class, department, both warehouse lists and their defaults. */
  @Get('create/form-options')
  @RequirePermissions('transfer-orders:create')
  createFormOptions(@CurrentUser() user: AuthUser) {
    return this.creator.formOptions(user);
  }

  /** Create TO form: one page of what the sending warehouse can transfer. */
  @Get('create/items')
  @RequirePermissions('transfer-orders:create')
  createItems(@Query() query: QueryToStockItemsDto) {
    return this.creator.stockItems(query);
  }

  /** Create TO form, Import Excel: the template to fill in. */
  @Get('create/import-template')
  @RequirePermissions('transfer-orders:create')
  async importTemplate(@Res() res: Response) {
    res.set(xlsxHeaders('template_import_TO.xlsx'));
    await writeToImportTemplate(res);
  }

  /**
   * Create TO form, Import Excel: read an uploaded workbook's rows (the file is
   * not stored). The form then checks them like a Quick Add paste.
   */
  @Post('create/import-parse')
  @HttpCode(200)
  @RequirePermissions('transfer-orders:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES } }))
  importParse(@UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Query('sheet') sheet?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an .xlsx file to import');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx files can be imported');
    return parseToImport(file.buffer, sheet || undefined);
  }

  /** Create TO form, Quick Add: match pasted Part Numbers to the sending warehouse's stock. */
  @Post('create/resolve-items')
  @HttpCode(200)
  @RequirePermissions('transfer-orders:create')
  resolveCreateItems(@Body() dto: ResolveToItemsDto) {
    return this.creator.resolveItems(dto);
  }

  /**
   * Save a Transfer Order: a Draft (`draft: true`, WMS only, still editable),
   * or submitted (Syncing; it is sent to Oracle in the background).
   */
  @Post()
  @RequirePermissions('transfer-orders:create')
  create(@Body() dto: CreateTransferOrderDto, @CurrentUser() user: AuthUser) {
    return this.creator.create(dto, user);
  }

  /** Edit a Draft (header and lines replaced); `draft: false` also submits it. */
  @Put(':id')
  @RequirePermissions('transfer-orders:create')
  updateDraft(@Param('id') id: string, @Body() dto: CreateTransferOrderDto, @CurrentUser() user: AuthUser) {
    return this.creator.updateDraft(id, dto, user);
  }

  /** Submit a Draft as saved: checked again, then sent to Oracle for approval. */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('transfer-orders:create')
  submitDraft(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.creator.submitDraft(id, user);
  }

  /** Delete a Draft (never sent to Oracle). */
  @Delete(':id')
  @RequirePermissions('transfer-orders:create')
  deleteDraft(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.creator.deleteDraft(id, user);
  }

  /** A Draft (purpose=edit) or a Rejected TO (purpose=clone) as Create TO form data. */
  @Get(':id/form-data')
  @RequirePermissions('transfer-orders:create')
  formData(@Param('id') id: string, @Query('purpose') purpose: string, @CurrentUser() user: AuthUser) {
    if (purpose !== 'edit' && purpose !== 'clone') throw new BadRequestException('purpose must be edit or clone');
    return this.creator.formData(id, purpose, user);
  }

  /** Send a Failed (WMS-created) Transfer Order to Oracle again. */
  @Post(':id/retry-sync')
  @HttpCode(200)
  @RequirePermissions('transfer-orders:create')
  retrySync(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.creator.retry(id, user);
  }

  // Pull transfer orders from Oracle into WMS (all statuses).
  @Post('sync-erp')
  @HttpCode(200)
  @RequirePermissions('transfer-orders:sync')
  syncErp(@Body() dto: SyncTransferOrderDto) {
    return this.sync.sync({
      lastModified: dto.lastModified,
      pageSize: dto.pageSize,
    });
  }

  /**
   * The TO Out (direction=out) or TO In (direction=in) list as an Excel file,
   * for whatever it is filtered and sorted by. Both come out in the same
   * "ITI TO" layout: they are the same Transfer Orders.
   */
  @Get('export')
  @RequirePermissions('transfer-orders:read')
  async export(@Query() query: QueryTransferOrderDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(transferOrderExportFileName()));
    await writeTransferOrderXlsx(this.service.exportRows(query, user), res);
  }

  /**
   * The export confirmation's numbers: documents (TOs) and rows for the
   * current status and filters and for all data, without building the file.
   */
  @Get('export/summary')
  @RequirePermissions('transfer-orders:read')
  exportSummary(@Query() query: QueryTransferOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.exportSummary(query, user);
  }

  @Get()
  @RequirePermissions('transfer-orders:read')
  findAll(@Query() query: QueryTransferOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('statuses')
  @RequirePermissions('transfer-orders:read')
  statuses(@CurrentUser() user: AuthUser) {
    return this.service.getStatuses(user);
  }

  @Get('erp-last-sync')
  @RequirePermissions('transfer-orders:read')
  lastSync() {
    return this.service.getLastSyncAt();
  }

  /** A TO seen from its destination warehouse (Inbound from Transfer Stock). */
  @Get('inbound/:id')
  @RequirePermissions('transfer-orders:read')
  findOneInbound(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOneInbound(id, user);
  }

  @Get(':id')
  @RequirePermissions('transfer-orders:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
