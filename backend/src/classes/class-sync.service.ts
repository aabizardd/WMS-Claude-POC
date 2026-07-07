import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface OracleClass {
  id: string;
  name?: string | null;
  is_inactive?: boolean | null;
  parent_id?: string | number | null;
  parent_name?: string | null;
  subsidiary_id?: string | number | null;
  subsidiary_name?: string | null;
  last_modified?: string | null;
}

interface OracleClassesResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleClass[];
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
export class ClassSyncService {
  private readonly logger = new Logger(ClassSyncService.name);

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
  ): Promise<OracleClassesResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/class/get`, {
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
        `Classes fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as OracleClassesResponse;
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
        ? `Starting incremental class sync (since ${lastModified})`
        : `Starting FULL class sync (pageSize=${pageSize})`,
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

      for (const c of res.data ?? []) {
        try {
          await this.upsert(c);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert class id=${c.id}: ${(e as Error).message}`,
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
    this.logger.log(`Class sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(c: OracleClass) {
    // last_modified may be an empty string — treat as null.
    const lm = c.last_modified ? new Date(c.last_modified) : null;
    const data = {
      name: c.name ?? null,
      isInactive: c.is_inactive ?? false,
      parentId: c.parent_id != null ? String(c.parent_id) : null,
      parentName: c.parent_name ?? null,
      subsidiaryId: c.subsidiary_id != null ? String(c.subsidiary_id) : null,
      subsidiaryName: c.subsidiary_name ?? null,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
    };
    await this.prisma.class.upsert({
      where: { oracleId: String(c.id) },
      update: data,
      create: { oracleId: String(c.id), createdBy: 'ERP Sync', ...data },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
