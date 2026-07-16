import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErpSyncService } from '../materials/erp-sync.service';
import { WarehouseSyncService } from '../warehouses/warehouse-sync.service';
import { VendorSyncService } from '../vendors/vendor-sync.service';
import { CustomerSyncService } from '../customers/customer-sync.service';
import { DepartmentSyncService } from '../departments/department-sync.service';
import { ClassSyncService } from '../classes/class-sync.service';
import { SubsidiarySyncService } from '../subsidiaries/subsidiary-sync.service';
import { MrnSyncService } from '../mrn/mrn-sync.service';
import { SalesOrderSyncService } from '../sales-orders/sales-order-sync.service';
import { PurchaseOrderSyncService } from '../purchase-orders/purchase-order-sync.service';
import { TransferOrderSyncService } from '../transfer-orders/transfer-order-sync.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type SyncLogOrder = Prisma.SyncLogOrderByWithRelationInput;
const SYNC_LOG_SORTABLE: Record<string, (d: SortDir) => SyncLogOrder> = {
  module: (d) => ({ module: d }),
  trigger: (d) => ({ trigger: d }),
  status: (d) => ({ status: d }),
  upserted: (d) => ({ upserted: d }),
  failed: (d) => ({ failed: d }),
  message: (d) => ({ message: d }),
  created_at: (d) => ({ createdAt: d }),
};

interface SyncerDef {
  watermark: () => Promise<Date | null>;
  run: (lastModified: string) => Promise<{
    upserted?: number;
    failed?: number;
    totalRecords?: number;
  }>;
}

interface Outcome {
  module: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  lastModified: string | null;
  upserted: number | null;
  failed: number | null;
  totalRecords: number | null;
  message: string | null;
  durationMs: number;
}

type LogList = Prisma.SyncLogGetPayload<object>;

// Central place that runs each Oracle sync module and records failed/partial
// runs to sync_logs (so admins can review + retry). Reused by the scheduler.
@Injectable()
export class SyncRunnerService {
  private readonly logger = new Logger(SyncRunnerService.name);
  private readonly registry: Record<string, SyncerDef>;

  constructor(
    private readonly prisma: PrismaService,
    materials: ErpSyncService,
    warehouses: WarehouseSyncService,
    vendors: VendorSyncService,
    customers: CustomerSyncService,
    departments: DepartmentSyncService,
    classes: ClassSyncService,
    subsidiaries: SubsidiarySyncService,
    mrn: MrnSyncService,
    salesOrders: SalesOrderSyncService,
    purchaseOrders: PurchaseOrderSyncService,
    transferOrders: TransferOrderSyncService,
  ) {
    const latestCreatedAt = async (
      model: {
        findFirst: (a: {
          where?: object;
          orderBy: object;
          select: object;
        }) => Promise<{ createdAt: Date } | null>;
      },
      where?: object,
    ) =>
      (
        await model.findFirst({
          where,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      )?.createdAt ?? null;

    this.registry = {
      materials: {
        watermark: () =>
          latestCreatedAt(this.prisma.material as never, {
            erpDocId: { not: null },
          }),
        run: (lm) => materials.sync({ lastModified: lm }),
      },
      warehouses: {
        watermark: () => latestCreatedAt(this.prisma.warehouse as never),
        run: (lm) => warehouses.sync({ lastModified: lm }),
      },
      vendors: {
        watermark: () => latestCreatedAt(this.prisma.vendor as never),
        run: (lm) => vendors.sync({ lastModified: lm }),
      },
      customers: {
        watermark: () => latestCreatedAt(this.prisma.customer as never),
        run: (lm) => customers.sync({ lastModified: lm }),
      },
      departments: {
        watermark: () => latestCreatedAt(this.prisma.department as never),
        run: (lm) => departments.sync({ lastModified: lm }),
      },
      classes: {
        watermark: () => latestCreatedAt(this.prisma.class as never),
        run: (lm) => classes.sync({ lastModified: lm }),
      },
      subsidiaries: {
        watermark: () => latestCreatedAt(this.prisma.subsidiary as never),
        run: (lm) => subsidiaries.sync({ lastModified: lm }),
      },
      mrn: {
        watermark: () => latestCreatedAt(this.prisma.mrn as never),
        run: (lm) => mrn.sync({ lastModified: lm }),
      },
      'sales-orders': {
        watermark: () => latestCreatedAt(this.prisma.salesOrder as never),
        run: (lm) => salesOrders.sync({ lastModified: lm }),
      },
      'purchase-orders': {
        watermark: () => latestCreatedAt(this.prisma.purchaseOrder as never),
        run: (lm) => purchaseOrders.sync({ lastModified: lm }),
      },
      'transfer-orders': {
        watermark: () => latestCreatedAt(this.prisma.transferOrder as never),
        run: (lm) => transferOrders.sync({ lastModified: lm }),
      },
    };
  }

  moduleNames() {
    return Object.keys(this.registry);
  }

  // Run a module (never throws). Computes the incremental watermark if none given.
  private async execute(module: string, lastModifiedOverride?: string): Promise<Outcome> {
    const def = this.registry[module];
    if (!def) throw new BadRequestException(`Unknown sync module: ${module}`);

    let lastModified = lastModifiedOverride ?? null;
    if (!lastModified) {
      const wm = await def.watermark();
      if (!wm) {
        return {
          module,
          status: 'skipped',
          lastModified: null,
          upserted: null,
          failed: null,
          totalRecords: null,
          message: 'No prior data — nothing to sync',
          durationMs: 0,
        };
      }
      lastModified = wm.toISOString();
    }

    const start = Date.now();
    try {
      const r = await def.run(lastModified);
      const failed = Number(r?.failed ?? 0);
      return {
        module,
        lastModified,
        status: failed > 0 ? 'partial' : 'success',
        upserted: r?.upserted ?? null,
        failed,
        totalRecords: r?.totalRecords ?? null,
        message: failed > 0 ? `${failed} record(s) failed to upsert` : null,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        module,
        lastModified,
        status: 'failed',
        upserted: null,
        failed: null,
        totalRecords: null,
        message: (e as Error).message?.slice(0, 1000) ?? 'Sync failed',
        durationMs: Date.now() - start,
      };
    }
  }

  // Scheduler entry point: run + persist a log only when there is a problem.
  async runScheduled(module: string): Promise<Outcome> {
    const o = await this.execute(module);
    if (o.status === 'failed' || o.status === 'partial') {
      await this.prisma.syncLog.create({
        data: {
          module,
          trigger: 'scheduler',
          status: o.status,
          lastModified: o.lastModified,
          upserted: o.upserted,
          failed: o.failed,
          totalRecords: o.totalRecords,
          message: o.message,
          durationMs: o.durationMs,
        },
      });
    }
    return o;
  }

  // ---------- log API ----------

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
    sort_by?: string;
    sort_order?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SYNC_LOG_SORTABLE, {
      createdAt: 'desc',
    });

    const where: Prisma.SyncLogWhereInput = {};
    if (query.status === 'failed' || query.status === 'partial' || query.status === 'success') {
      where.status = query.status;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.syncLog.count({ where }),
      this.prisma.syncLog.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: {
        page,
        limit,
        status: query.status ?? null,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) => this.serialize(r)),
    };
  }

  // Re-run the failed module using the same "since" value; update the log row.
  async retry(id: string) {
    const log = await this.prisma.syncLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException(`Sync log ${id} not found`);

    const o = await this.execute(log.module, log.lastModified ?? undefined);
    const status = o.status === 'skipped' ? 'success' : o.status;
    const updated = await this.prisma.syncLog.update({
      where: { id },
      data: {
        trigger: 'retry',
        status,
        upserted: o.upserted,
        failed: o.failed,
        totalRecords: o.totalRecords,
        message: o.status === 'skipped' ? 'Nothing to sync' : o.message,
        durationMs: o.durationMs,
        retriedAt: new Date(),
      },
    });
    this.logger.log(`Retried sync log ${id} (${log.module}) → ${status}`);
    return this.serialize(updated);
  }

  private serialize(l: LogList) {
    return {
      id: l.id,
      module: l.module,
      trigger: l.trigger,
      status: l.status,
      last_modified: l.lastModified,
      upserted: l.upserted,
      failed: l.failed,
      total_records: l.totalRecords,
      message: l.message,
      duration_ms: l.durationMs,
      retried_at: l.retriedAt,
      created_at: l.createdAt,
    };
  }
}
