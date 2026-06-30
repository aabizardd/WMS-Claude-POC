import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';
import { UpdateActualsDto } from './dto/update-actuals.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('goods-receive')
export class GoodsReceiveController {
  constructor(private readonly service: GoodsReceiveService) {}

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
}
