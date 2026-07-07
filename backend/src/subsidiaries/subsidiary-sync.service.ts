import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface OracleSubsidiary {
  subsidiary_id: string | number;
  subsidiary_name?: string | null;
  subsidiary_fullname?: string | null;
  is_delete?: boolean | null;
  updated_at?: string | null;
  created_at?: string | null;
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
  ) {}

  private baseUrl() {
    const url = this.config.get<string>('ERP_BASE_URL');
    if (!url) throw new Error('ERP_BASE_URL is not configured');
    return url.replace(/\/$/, '');
  }

  async getAccessToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl()}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.config.get<string>('ERP_CLIENT_ID'),
        client_secret: this.config.get<string>('ERP_CLIENT_SECRET'),
      }),
    });
    if (!res.ok) {
      throw new Error(`ERP auth failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as ErpAuthResponse;
    const token = json?.data?.access_token;
    if (!token) throw new Error('ERP auth: access_token missing in response');
    return token;
  }

  private async fetchPage(
    token: string,
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<OracleSubsidiariesResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/subsidiary/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        page,
        page_size: pageSize,
        sort_by: 'lastmodifieddate',
        sort_order: 'DESC',
        filters,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Subsidiaries fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as OracleSubsidiariesResponse;
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

    const token = await this.getAccessToken();
    let page = 1;
    let totalPages = 1;
    let totalRecords = 0;
    let upserted = 0;
    let failed = 0;

    do {
      if (page > 1 && pageDelayMs > 0) await this.delay(pageDelayMs);

      const res = await this.fetchPage(token, page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const s of res.data ?? []) {
        try {
          await this.upsert(s);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert subsidiary id=${s.subsidiary_id}: ${(e as Error).message}`,
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
    // Oracle has no last_modified; use updated_at for the display timestamp.
    const lm = s.updated_at ? new Date(s.updated_at) : null;
    const data = {
      name: s.subsidiary_name ?? null,
      fullName: s.subsidiary_fullname ?? null,
      isDelete: s.is_delete ?? false,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
    };
    await this.prisma.subsidiary.upsert({
      where: { oracleId: String(s.subsidiary_id) },
      update: data,
      create: {
        oracleId: String(s.subsidiary_id),
        createdBy: 'ERP Sync',
        ...data,
      },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
