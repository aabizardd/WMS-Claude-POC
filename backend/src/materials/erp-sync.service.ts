import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string; token_type: string; expires_in: number };
}

interface ErpItem {
  internalId: string;
  itemId: string;
  displayName: string;
  last_modified?: string;
  locations?: unknown[];
}

interface ErpItemsResponse {
  success: boolean;
  page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
  data: ErpItem[];
}

export interface SyncOptions {
  // ISO datetime string, e.g. "2024-06-25T09:04:00+07:00".
  // When omitted -> full sync of all items.
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
export class ErpSyncService {
  private readonly logger = new Logger(ErpSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private baseUrl() {
    const url = this.config.get<string>('ERP_BASE_URL');
    if (!url) throw new Error('ERP_BASE_URL is not configured');
    return url.replace(/\/$/, '');
  }

  /** Obtain a bearer access token via client_credentials. */
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

  /** Fetch a single page of items. */
  private async fetchItemsPage(
    token: string,
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<ErpItemsResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/items/get`, {
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
        `ERP items fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as ErpItemsResponse;
  }

  /**
   * Pull every page of items (max pageSize per page) and UPSERT into materials.
   * Matches by erp_doc_id (internalId); falls back to material_code if a record
   * with the same code already exists without an erp_doc_id.
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const start = Date.now();
    const pageSize = Math.min(
      options.pageSize ??
        Number(this.config.get('ERP_SYNC_PAGE_SIZE') ?? 200),
      200,
    );
    const lastModified = options.lastModified;

    this.logger.log(
      lastModified
        ? `Starting incremental ERP sync (lastModified=${lastModified}, pageSize=${pageSize})`
        : `Starting FULL ERP sync (pageSize=${pageSize})`,
    );

    const token = await this.getAccessToken();

    let page = 1;
    let totalPages = 1;
    let totalRecords = 0;
    let upserted = 0;
    let failed = 0;

    // Delay between page requests to respect the ERP rate limit.
    const pageDelayMs = Number(
      this.config.get('ERP_SYNC_PAGE_DELAY_MS') ?? 1500,
    );

    do {
      // Wait before every request except the first one.
      if (page > 1 && pageDelayMs > 0) {
        await this.delay(pageDelayMs);
      }

      const res = await this.fetchItemsPage(
        token,
        page,
        pageSize,
        lastModified,
      );
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const item of res.data ?? []) {
        try {
          await this.upsertItem(item);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert item internalId=${item.internalId}: ${
              (e as Error).message
            }`,
          );
        }
      }

      this.logger.log(
        `Page ${page}/${totalPages} processed — upserted=${upserted}, failed=${failed}`,
      );
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
    this.logger.log(`ERP sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async upsertItem(item: ErpItem) {
    const erpDocId = String(item.internalId);
    const materialCode = item.itemId;
    const materialName = item.displayName ?? '';

    try {
      await this.prisma.material.upsert({
        where: { erpDocId },
        update: { materialCode, materialName, modifiedBy: 'ERP Sync' },
        create: {
          erpDocId,
          materialCode,
          materialName,
          createdBy: 'ERP Sync',
          modifiedBy: 'ERP Sync',
        },
      });
    } catch (e) {
      // A material with this code may already exist without an erp_doc_id
      // (e.g. created manually or seeded) — reconcile by linking the erp_doc_id.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        await this.prisma.material.update({
          where: { materialCode },
          data: { erpDocId, materialName, modifiedBy: 'ERP Sync' },
        });
        return;
      }
      throw e;
    }
  }
}
