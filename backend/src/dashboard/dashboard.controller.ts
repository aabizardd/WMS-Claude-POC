import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // Aggregated transaction dashboard, scoped to the active/own warehouse.
  // Any authenticated user may read it (no extra permission required).
  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.service.summary(user, query.range ?? 30);
  }
}
