import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { TransferInboundService } from './transfer-inbound.service';
import { QueryTransferInboundDto } from './dto/query-transfer-inbound.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

// Transfer IN screens (Goods Receive, Putaway, History) as WMS dev lays them out.
@Controller('transfer-inbound')
export class TransferInboundController {
  constructor(private readonly service: TransferInboundService) {}

  @Get('goods-receive')
  @RequirePermissions('goods-receive:read')
  listGoodsReceives(@Query() q: QueryTransferInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.listGoodsReceives(q, user);
  }

  @Get('goods-receive/:id')
  @RequirePermissions('goods-receive:read')
  goodsReceive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.goodsReceive(id, user);
  }

  @Delete('goods-receive/:id')
  @RequirePermissions('goods-receive:delete')
  deleteGoodsReceive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deleteGoodsReceive(id, user);
  }

  @Get('putaway')
  @RequirePermissions('putaway:read')
  listPutaways(@Query() q: QueryTransferInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.listPutaways(q, user);
  }

  @Get('putaway/:id')
  @RequirePermissions('putaway:read')
  putaway(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.putaway(id, user);
  }

  @Delete('putaway/:id')
  @RequirePermissions('putaway:delete')
  deletePutaway(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deletePutaway(id, user);
  }

  @Get('history')
  @RequirePermissions('putaway:read')
  history(@Query() q: QueryTransferInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.history(q, user);
  }
}
