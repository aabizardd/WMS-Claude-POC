import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface OracleVendor {
  internalId: string;
  entityId?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  terms?: string | null;
  terms_display?: string | null;
  subsidiary?: string | null;
  subsidiary_display?: string | null;
  last_modified?: string | null;
}

interface OracleVendorsResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleVendor[];
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
export class VendorSyncService {
  private readonly logger = new Logger(VendorSyncService.name);

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
  ): Promise<OracleVendorsResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/vendors/get`, {
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
        `Vendors fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as OracleVendorsResponse;
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
        ? `Starting incremental vendor sync (since ${lastModified})`
        : `Starting FULL vendor sync (pageSize=${pageSize})`,
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

      for (const v of res.data ?? []) {
        try {
          await this.upsert(v);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert vendor id=${v.internalId}: ${(e as Error).message}`,
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
    this.logger.log(`Vendor sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(v: OracleVendor) {
    const data = {
      entityId: v.entityId ?? null,
      companyName: v.companyName ?? null,
      email: v.email ?? null,
      phone: v.phone ?? null,
      terms: v.terms ?? null,
      termsDisplay: v.terms_display ?? null,
      subsidiaryId: v.subsidiary ?? null,
      subsidiaryDisplay: v.subsidiary_display ?? null,
      lastModified: v.last_modified ? new Date(v.last_modified) : null,
    };
    await this.prisma.vendor.upsert({
      where: { oracleId: String(v.internalId) },
      update: data,
      create: { oracleId: String(v.internalId), createdBy: 'ERP Sync', ...data },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
