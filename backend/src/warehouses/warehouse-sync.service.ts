import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface OracleLocation {
  id: string;
  name: string;
  is_inactive: boolean;
  parent_id?: string | null;
  parent_name?: string | null;
  subsidiary_id?: string | null;
  subsidiary_name?: string | null;
  location_type?: string | null;
  location_type_name?: string | null;
  timezone?: string | null;
  make_inventory_available?: boolean;
  last_modified?: string | null;
}

interface OracleLocationsResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleLocation[];
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
export class WarehouseSyncService {
  private readonly logger = new Logger(WarehouseSyncService.name);

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
  ): Promise<OracleLocationsResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/locations/get`, {
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
        `Locations fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as OracleLocationsResponse;
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
        ? `Starting incremental warehouse sync (since ${lastModified})`
        : `Starting FULL warehouse sync (pageSize=${pageSize})`,
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

      for (const loc of res.data ?? []) {
        try {
          await this.upsert(loc);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert location id=${loc.id}: ${(e as Error).message}`,
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
    this.logger.log(`Warehouse sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(loc: OracleLocation) {
    const data = {
      name: loc.name,
      isInactive: !!loc.is_inactive,
      parentId: loc.parent_id ?? null,
      parentName: loc.parent_name ?? null,
      subsidiaryId: loc.subsidiary_id ?? null,
      subsidiaryName: loc.subsidiary_name ?? null,
      locationType: loc.location_type ?? null,
      locationTypeName: loc.location_type_name ?? null,
      timezone: loc.timezone ?? null,
      makeInventoryAvailable: !!loc.make_inventory_available,
      lastModified: loc.last_modified ? new Date(loc.last_modified) : null,
    };
    await this.prisma.warehouse.upsert({
      where: { oracleId: String(loc.id) },
      update: data,
      create: { oracleId: String(loc.id), createdBy: 'ERP Sync', ...data },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
