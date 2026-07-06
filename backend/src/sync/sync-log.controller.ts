import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SyncRunnerService } from './sync-runner.service';
import { QuerySyncLogDto } from './dto/query-sync-log.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('sync-logs')
export class SyncLogController {
  constructor(private readonly runner: SyncRunnerService) {}

  @Get()
  @RequirePermissions('sync-logs:read')
  findAll(@Query() query: QuerySyncLogDto) {
    return this.runner.findAll(query);
  }

  // Re-run the failed/partial sync with the same "since" value.
  @Post(':id/retry')
  @RequirePermissions('sync-logs:update')
  retry(@Param('id') id: string) {
    return this.runner.retry(id);
  }
}
