import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ErpSyncService } from '../materials/erp-sync.service';
import { WarehouseSyncService } from '../warehouses/warehouse-sync.service';
import { VendorSyncService } from '../vendors/vendor-sync.service';
import { CustomerSyncService } from '../customers/customer-sync.service';
import { MrnSyncService } from '../mrn/mrn-sync.service';
import { SalesOrderSyncService } from '../sales-orders/sales-order-sync.service';

// Minimal shape shared by every SyncService result.
interface SyncResultLike {
  upserted: number;
  failed: number;
}

interface Syncer {
  name: string;
  // Incremental watermark = latest createdAt already stored, i.e. the same
  // basis the manual "Sync from ERP" button uses (getLastSyncAt).
  watermark: () => Promise<Date | null>;
  run: (lastModified: string) => Promise<SyncResultLike>;
}

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute

/**
 * Periodically triggers an incremental (Last Modified based) Oracle sync for
 * every mirrored module. This is an additional trigger next to the CLI inject
 * and the manual button — it does not change any existing sync business logic.
 *
 * - Interval is configurable via ERP_SYNC_INTERVAL_MS (default 5 min).
 * - Can be turned off via ERP_SYNC_SCHEDULER_ENABLED=false.
 * - Runs modules sequentially with a delay between them to respect the ERP
 *   rate limit, and guards against overlapping runs.
 */
@Injectable()
export class OracleSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OracleSyncScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly syncers: Syncer[];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    materials: ErpSyncService,
    warehouses: WarehouseSyncService,
    vendors: VendorSyncService,
    customers: CustomerSyncService,
    mrn: MrnSyncService,
    salesOrders: SalesOrderSyncService,
  ) {
    this.syncers = [
      {
        name: 'materials',
        watermark: async () =>
          (
            await this.prisma.material.findFirst({
              where: { erpDocId: { not: null } },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        run: (lm) => materials.sync({ lastModified: lm }),
      },
      {
        name: 'warehouses',
        watermark: async () =>
          (
            await this.prisma.warehouse.findFirst({
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        run: (lm) => warehouses.sync({ lastModified: lm }),
      },
      {
        name: 'vendors',
        watermark: async () =>
          (
            await this.prisma.vendor.findFirst({
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        run: (lm) => vendors.sync({ lastModified: lm }),
      },
      {
        name: 'customers',
        watermark: async () =>
          (
            await this.prisma.customer.findFirst({
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        run: (lm) => customers.sync({ lastModified: lm }),
      },
      {
        name: 'mrn',
        watermark: async () =>
          (
            await this.prisma.mrn.findFirst({
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        run: (lm) => mrn.sync({ lastModified: lm }),
      },
      {
        name: 'sales-orders',
        watermark: async () =>
          (
            await this.prisma.salesOrder.findFirst({
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        run: (lm) => salesOrders.sync({ lastModified: lm }),
      },
    ];
  }

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
      for (let i = 0; i < this.syncers.length; i++) {
        const s = this.syncers[i];
        // Delay between modules to respect the ERP rate limit.
        if (i > 0 && gapMs > 0) await this.delay(gapMs);
        try {
          const wm = await s.watermark();
          if (!wm) {
            this.logger.log(
              `[${s.name}] no prior data — skipping (scheduler is incremental only)`,
            );
            continue;
          }
          const lastModified = wm.toISOString();
          const r = await s.run(lastModified);
          this.logger.log(
            `[${s.name}] incremental sync since ${lastModified} — upserted=${r.upserted}, failed=${r.failed}`,
          );
        } catch (e) {
          // One module failing must not stop the others.
          this.logger.error(
            `[${s.name}] scheduled sync failed: ${(e as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
