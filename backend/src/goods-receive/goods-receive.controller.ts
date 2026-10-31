import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { GoodsReceiveReceiveService } from './goods-receive-receive.service';
import { GoodsReceiveFromPoService } from './goods-receive-from-po.service';
import { GoodsReceiveFromToService } from './goods-receive-from-to.service';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';
import { UpdateActualsDto } from './dto/update-actuals.dto';
import { GenerateGrListFromPoDto } from './dto/generate-gr-from-po.dto';
import { GenerateGrListFromToDto } from './dto/generate-gr-from-to.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('goods-receive')
export class GoodsReceiveController {
  constructor(
    private readonly service: GoodsReceiveService,
    private readonly receive: GoodsReceiveReceiveService,
    private readonly fromPo: GoodsReceiveFromPoService,
    private readonly fromTo: GoodsReceiveFromToService,
  ) {}

  // Generate GR List from a Purchase Order (Inbound from Local Vendor): an
  // Open GR with planned quantities. Oracle is hit later, on Receive.
  // Declared before ':id' routes.
  @Post('generate-list-from-po')
  @RequirePermissions('goods-receive:create')
  generateListFromPo(@Body() dto: GenerateGrListFromPoDto, @CurrentUser() user: AuthUser) {
    return this.fromPo.generateList(dto, user);
  }

  // Generate GR List from a Transfer Order (Inbound from Transfer Stock): an
  // Open GR with planned quantities. Oracle is hit later, on Receive.
  @Post('generate-list-from-to')
  @RequirePermissions('goods-receive:create')
  generateListFromTo(@Body() dto: GenerateGrListFromToDto, @CurrentUser() user: AuthUser) {
    return this.fromTo.generateList(dto, user);
  }

  @Get()
  @RequirePermissions('goods-receive:read')
  findAll(@Query() query: QueryGoodsReceiveDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('goods-receive:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  // Save the actual received quantities for the GR's items.
  @Put(':id/actuals')
  @RequirePermissions('goods-receive:update')
  updateActuals(
    @Param('id') id: string,
    @Body() dto: UpdateActualsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateActuals(id, dto, user);
  }

  // Trigger ERP receive for the Goods Receive document (background process).
  @Post(':id/receive')
  @RequirePermissions('goods-receive:update')
  async triggerReceive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    // TO / PO source: the Oracle Item Receipt is submitted right away, so a
    // refusal reaches the user instead of ending in Sync Failed.
    const gr = await this.service.findOne(id, user);
    if (gr.source_type === 'TO') return this.fromTo.receive(id, user);
    if (gr.source_type === 'PO') return this.fromPo.receive(id, user);
    const result = await this.receive.startReceive(id, user);
    void this.receive.processInBackground(id);
    return result;
  }
}
