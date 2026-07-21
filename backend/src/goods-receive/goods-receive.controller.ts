import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { GoodsReceiveReceiveService } from './goods-receive-receive.service';
import { GoodsReceiveFromPoService } from './goods-receive-from-po.service';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';
import { UpdateActualsDto } from './dto/update-actuals.dto';
import { GenerateGrFromPoDto } from './dto/generate-gr-from-po.dto';
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
  ) {}

  // Generate a GR from a Purchase Order — submits an Oracle Item Receipt.
  // Declared before ':id' routes.
  @Post('generate-from-po')
  @RequirePermissions('goods-receive:create')
  generateFromPo(@Body() dto: GenerateGrFromPoDto, @CurrentUser() user: AuthUser) {
    return this.fromPo.generate(dto, user);
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
    const result = await this.receive.startReceive(id, user);
    void this.receive.processInBackground(id);
    return result;
  }
}
