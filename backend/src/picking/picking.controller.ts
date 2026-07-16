import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PickingService } from './picking.service';
import { GeneratePickingDto } from './dto/generate-picking.dto';
import { ProgressPickingDto } from './dto/progress-picking.dto';
import { QueryPickingDto } from './dto/query-picking.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('picking')
export class PickingController {
  constructor(private readonly service: PickingService) {}

  @Get()
  @RequirePermissions('picking:read')
  findAll(@Query() query: QueryPickingDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  // Data for the Generate Picking form (items with remaining + source bins).
  @Get('pickable/:salesOrderId')
  @RequirePermissions('picking:create')
  pickable(
    @Param('salesOrderId') salesOrderId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getPickable(salesOrderId, user);
  }

  // Data for the Generate Picking form from a Transfer Order source.
  @Get('pickable-transfer/:transferOrderId')
  @RequirePermissions('picking:create')
  pickableTransfer(
    @Param('transferOrderId') transferOrderId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getPickableTransfer(transferOrderId, user);
  }

  @Get(':id')
  @RequirePermissions('picking:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('picking:create')
  generate(@Body() dto: GeneratePickingDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  // Input picking progress (actual / qty issue / quality issue) per item.
  @Put(':id/progress')
  @RequirePermissions('picking:update')
  progress(
    @Param('id') id: string,
    @Body() dto: ProgressPickingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.progress(id, dto.items, user);
  }

  // Delete an Open picking; rolls back SO remaining + reserved stock.
  @Delete(':id')
  @RequirePermissions('picking:delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
