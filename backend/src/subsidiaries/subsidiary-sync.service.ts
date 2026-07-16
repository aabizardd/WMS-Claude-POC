import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';

interface OracleSubsidiary {
  netsuite_id: string | number;
  subsidiary_name?: string | null;
  legalname?: string | null;
  isinactive?: boolean | null;
}

interface OracleSubsidiariesResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleSubsidiary[];
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
export class SubsidiarySyncService {
  private readonly logger = new Logger(SubsidiarySyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private erp: ErpHttpService,
  ) {}

  private fetchPage(
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<OracleSubsidiariesResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;
    return this.erp.post<OracleSubsidiariesResponse>('/subsidiary/get', {
      page,
      page_size: pageSize,
      sort_by: 'lastmodifieddate',
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
        ? `Starting incremental subsidiary sync (since ${lastModified})`
        : `Starting FULL subsidiary sync (pageSize=${pageSize})`,
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

      for (const s of res.data ?? []) {
        try {
          if (s.netsuite_id == null) {
            failed++;
            this.logger.warn('Skipping subsidiary with null netsuite_id');
            continue;
          }
          await this.upsert(s);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert subsidiary id=${s.netsuite_id}: ${(e as Error).message}`,
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
    this.logger.log(`Subsidiary sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(s: OracleSubsidiary) {
    const data = {
      name: s.subsidiary_name ?? null,
      fullName: s.legalname ?? null,
      isDelete: s.isinactive ?? false,
    };
    await this.prisma.subsidiary.upsert({
      where: { oracleId: String(s.netsuite_id) },
      update: data,
      create: {
        oracleId: String(s.netsuite_id),
        createdBy: 'ERP Sync',
        ...data,
      },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
