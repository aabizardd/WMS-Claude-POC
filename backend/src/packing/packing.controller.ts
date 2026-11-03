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
import { packingExportFileName, writePackingXlsx } from './packing-export';
import { PackingService } from './packing.service';
import { GeneratePackingDto } from './dto/generate-packing.dto';
import { ProgressPackingDto } from './dto/progress-packing.dto';
import { QueryPackingDto } from './dto/query-packing.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('packing')
export class PackingController {
  constructor(private readonly service: PackingService) {}

  @Get()
  @RequirePermissions('packing:read')
  findAll(@Query() query: QueryPackingDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  // Closed pickings that can still be packed (for the Generate Packing modal).
  @Get('available-pickings')
  @RequirePermissions('packing:create')
  availablePickings(@CurrentUser() user: AuthUser) {
    return this.service.availablePickings(user);
  }

  @Get(':id')
  @RequirePermissions('packing:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  // The detail's ☰ Export: WMS dev's "Packing List" sheet, one row per material.
  @Get(':id/export')
  @RequirePermissions('packing:read')
  async exportOne(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const doc = await this.service.findOne(id, user);
    res.set(xlsxHeaders(packingExportFileName(doc)));
    await writePackingXlsx(doc, res);
  }

  @Post('generate')
  @RequirePermissions('packing:create')
  generate(@Body() dto: GeneratePackingDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  // Record packing progress; closes the packing when all remaining reach 0.
  @Put(':id/progress')
  @RequirePermissions('packing:update')
  progress(
    @Param('id') id: string,
    @Body() dto: ProgressPackingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.progress(id, dto, user);
  }

  // Delete an Open packing; its pickings reopen (picked again).
  @Delete(':id')
  @RequirePermissions('packing:delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
