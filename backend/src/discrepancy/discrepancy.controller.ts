import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiscrepancyService } from './discrepancy.service';
import { QueryDiscrepancyDto } from './dto/query-discrepancy.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('discrepancy')
export class DiscrepancyController {
  constructor(private readonly service: DiscrepancyService) {}

  @Get()
  @RequirePermissions('discrepancy:read')
  findAll(@Query() query: QueryDiscrepancyDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('discrepancy:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
