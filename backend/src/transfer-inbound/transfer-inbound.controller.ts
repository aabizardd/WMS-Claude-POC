import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { TransferInboundService, type InboundSource } from './transfer-inbound.service';
import { QueryTransferInboundDto } from './dto/query-transfer-inbound.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

/**
 * The Goods Receive / Putaway / History screens of one inbound, as WMS dev
 * lays them out. Transfer IN and Local Vendor share them; each gets its own
 * route prefix below.
 */
abstract class InboundScreensController {
  protected abstract readonly source: InboundSource;

  constructor(protected readonly service: TransferInboundService) {}

  @Get('goods-receive')
  @RequirePermissions('goods-receive:read')
  listGoodsReceives(@Query() q: QueryTransferInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.listGoodsReceives(this.source, q, user);
  }

  @Get('goods-receive/:id')
  @RequirePermissions('goods-receive:read')
  goodsReceive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.goodsReceive(this.source, id, user);
  }

  @Delete('goods-receive/:id')
  @RequirePermissions('goods-receive:delete')
  deleteGoodsReceive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deleteGoodsReceive(this.source, id, user);
  }

  @Get('putaway')
  @RequirePermissions('putaway:read')
  listPutaways(@Query() q: QueryTransferInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.listPutaways(this.source, q, user);
  }

  @Get('putaway/:id')
  @RequirePermissions('putaway:read')
  putaway(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.putaway(this.source, id, user);
  }

  @Delete('putaway/:id')
  @RequirePermissions('putaway:delete')
  deletePutaway(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deletePutaway(this.source, id, user);
  }

  @Get('history')
  @RequirePermissions('putaway:read')
  history(@Query() q: QueryTransferInboundDto, @CurrentUser() user: AuthUser) {
    return this.service.history(this.source, q, user);
  }
}

// Transfer IN (Inbound from Transfer Order).
@Controller('transfer-inbound')
export class TransferInboundController extends InboundScreensController {
  protected readonly source = 'TO';

  // Own constructor: Nest reads the injected types from the decorated class.
  constructor(service: TransferInboundService) {
    super(service);
  }
}

// Local Vendor (Inbound from Purchase Order).
@Controller('po-inbound')
export class PoInboundController extends InboundScreensController {
  protected readonly source = 'PO';

  // Own constructor: Nest reads the injected types from the decorated class.
  constructor(service: TransferInboundService) {
    super(service);
  }
}
