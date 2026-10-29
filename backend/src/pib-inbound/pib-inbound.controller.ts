import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { PibInboundService } from './pib-inbound.service';
import { PutawayService } from '../putaway/putaway.service';
import { QueryPibInboundDto } from './dto/query-pib-inbound.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

// Inbound from PIB screens (Goods Receive, Putaway, History) as WMS dev lays them out.
@Controller('pib-inbound')
export class PibInboundController {
  constructor(
    private readonly service: PibInboundService,
    private readonly putaways: PutawayService,
  ) {}

  @Get('goods-receive')
  @RequirePermissions('goods-receive:read')
  listGoodsReceives(@Query() q: QueryPibInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.listGoodsReceives(q, user);
  }

  @Get('goods-receive/:id')
  @RequirePermissions('goods-receive:read')
  goodsReceive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.goodsReceive(id, user);
  }

  @Get('putaway')
  @RequirePermissions('putaway:read')
  listPutaways(@Query() q: QueryPibInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.listPutaways(q, user);
  }

  @Get('putaway/:id')
  @RequirePermissions('putaway:read')
  putaway(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.putaway(id, user);
  }

  /** Delete an untouched putaway: its qty goes back to the GR to put away again. */
  @Delete('putaway/:id')
  @RequirePermissions('putaway:delete')
  deletePutaway(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.putaways.remove(id, user);
  }

  @Get('history')
  @RequirePermissions('putaway:read')
  history(@Query() q: QueryPibInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.history(q, user);
  }
}
