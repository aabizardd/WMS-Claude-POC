import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncRunnerService } from './sync-runner.service';

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute

/**
 * Periodically triggers an incremental (Last Modified based) Oracle sync for
 * every mirrored module via SyncRunnerService (which records failed/partial
 * runs to sync_logs). Does not change any sync business logic.
 *
 * - Interval configurable via ERP_SYNC_INTERVAL_MS.
 * - Disable via ERP_SYNC_SCHEDULER_ENABLED=false.
 * - Runs modules sequentially with a delay between them (ERP rate limit) and
 *   guards against overlapping runs. Keep a single instance in production.
 */
@Injectable()
export class OracleSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OracleSyncScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly runner: SyncRunnerService,
  ) {}

  onModuleInit() {
    const enabled =
      (this.config.get<string>('ERP_SYNC_SCHEDULER_ENABLED') ?? 'true') !==
      'false';
    if (!enabled) {
      this.logger.log(
        'Oracle sync scheduler disabled (ERP_SYNC_SCHEDULER_ENABLED=false)',
      );
      return;
    }
    const intervalMs =
      Number(this.config.get('ERP_SYNC_INTERVAL_MS')) || DEFAULT_INTERVAL_MS;
    this.logger.log(
      `Oracle sync scheduler enabled — running incremental sync every ${intervalMs}ms`,
    );
    // First run happens after one interval, not on boot.
    this.timer = setInterval(() => void this.runAll(), intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run one incremental pass over every module. Safe to call repeatedly. */
  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Previous Oracle sync run still in progress — skipping this tick',
      );
      return;
    }
    this.running = true;
    const gapMs = Number(this.config.get('ERP_SYNC_PAGE_DELAY_MS') ?? 1500);
    try {
      const modules = this.runner.moduleNames();
      for (let i = 0; i < modules.length; i++) {
        if (i > 0 && gapMs > 0) await this.delay(gapMs);
        const o = await this.runner.runScheduled(modules[i]);
        this.logger.log(
          `[${modules[i]}] ${o.status}` +
            (o.status === 'failed' ? ` — ${o.message}` : ` — upserted=${o.upserted ?? 0}, failed=${o.failed ?? 0}`),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
