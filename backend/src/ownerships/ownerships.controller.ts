import { Controller, Get, Query } from '@nestjs/common';
import { OwnershipsService } from './ownerships.service';
import { QueryOwnershipDto } from './dto/query-ownership.dto';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('ownerships')
export class OwnershipsController {
  constructor(private readonly service: OwnershipsService) {}

  // No @RequirePermissions: vendors:read OR customers:read is enough, and the
  // service only returns the half the user may read.
  @Get()
  findAll(@Query() query: QueryOwnershipDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }
}
