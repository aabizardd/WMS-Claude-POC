import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';

interface OracleCustomer {
  internalId: string;
  entityId?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  last_modified?: string | null;
}

interface OracleCustomersResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleCustomer[];
}

export interface SyncOptions {
  lastModified?: string;
  pageSize?: number;
}

export interface SyncResult {
  fullSync: boolean;
  lastModified: string | null;
  totalRecords: number;
  totalPages: number;
  pagesFetched: number;
  upserted: number;
  failed: number;
  durationMs: number;
}

@Injectable()
export class CustomerSyncService {
  private readonly logger = new Logger(CustomerSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private erp: ErpHttpService,
  ) {}

  private fetchPage(
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<OracleCustomersResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;
    return this.erp.post<OracleCustomersResponse>('/customers/get', {
      page,
      page_size: pageSize,
      sort_by: 'lastModifiedDate',
      sort_order: 'DESC',
      filters,
    });
  }

  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const start = Date.now();
    const pageSize = Math.min(
      options.pageSize ?? Number(this.config.get('ERP_SYNC_PAGE_SIZE') ?? 200),
      200,
    );
    const pageDelayMs = Number(this.config.get('ERP_SYNC_PAGE_DELAY_MS') ?? 1500);
    const lastModified = options.lastModified;

    this.logger.log(
      lastModified
        ? `Starting incremental customer sync (since ${lastModified})`
        : `Starting FULL customer sync (pageSize=${pageSize})`,
    );

    let page = 1;
    let totalPages = 1;
    let totalRecords = 0;
    let upserted = 0;
    let failed = 0;

    do {
      if (page > 1 && pageDelayMs > 0) await this.delay(pageDelayMs);

      const res = await this.fetchPage(page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const c of res.data ?? []) {
        try {
          await this.upsert(c);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert customer id=${c.internalId}: ${(e as Error).message}`,
          );
        }
      }
      this.logger.log(`Page ${page}/${totalPages} — upserted=${upserted}`);
      page++;
    } while (page <= totalPages);

    const result: SyncResult = {
      fullSync: !lastModified,
      lastModified: lastModified ?? null,
      totalRecords,
      totalPages,
      pagesFetched: page - 1,
      upserted,
      failed,
      durationMs: Date.now() - start,
    };
    this.logger.log(`Customer sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(c: OracleCustomer) {
    // last_modified may be an empty string — treat as null.
    const lm = c.last_modified ? new Date(c.last_modified) : null;
    const data = {
      entityId: c.entityId ?? null,
      companyName: c.companyName ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
    };
    await this.prisma.customer.upsert({
      where: { oracleId: String(c.internalId) },
      update: data,
      create: { oracleId: String(c.internalId), createdBy: 'ERP Sync', ...data },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
