import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { xlsxHeaders } from '../common/xlsx-export';
import { BinsService, binExportFileName, writeBinXlsx } from './bins.service';
import { CreateBinDto } from './dto/create-bin.dto';
import { UpdateBinDto } from './dto/update-bin.dto';
import { QueryBinDto } from './dto/query-bin.dto';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('bins')
export class BinsController {
  constructor(private readonly service: BinsService) {}

  @Get()
  @RequirePermissions('bins:read')
  findAll(@Query() query: QueryBinDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  // The list's export: every bin the search matches, its columns on one sheet.
  // Declared before ':id'.
  @Get('export')
  @RequirePermissions('bins:read')
  async export(@Query() query: QueryBinDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.set(xlsxHeaders(binExportFileName()));
    await writeBinXlsx(this.service.exportRows(query, user), res);
  }

  /** The export confirmation's numbers: bins for the current search and for all data. */
  @Get('export/summary')
  @RequirePermissions('bins:read')
  exportSummary(@Query() query: QueryBinDto, @CurrentUser() user: AuthUser) {
    return this.service.exportSummary(query, user);
  }

  // Lookup for dropdowns — any authenticated user (declared before ':id').
  @Get('options')
  options(@Query('warehouseId') warehouseId?: string) {
    return this.service.options(warehouseId);
  }

  @Get(':id')
  @RequirePermissions('bins:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('bins:create')
  create(@Body() dto: CreateBinDto, @CurrentUser('username') username: string) {
    return this.service.create(dto, username);
  }

  @Put(':id')
  @RequirePermissions('bins:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBinDto,
    @CurrentUser('username') username: string,
  ) {
    return this.service.update(id, dto, username);
  }

  @Delete(':id')
  @RequirePermissions('bins:delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
