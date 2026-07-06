import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface OracleSalesOrderItem {
  line_number?: number;
  item_id?: string | number | null;
  item_name?: string | null;
  quantity?: number;
  rate?: number;
  amount?: number;
  shipped?: number;
  description?: string | null;
  location_id?: string | number | null;
}

interface OracleSalesOrder {
  id: string | number;
  tranid?: string | null;
  tran_date?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  customer_id?: string | number | null;
  customer_name?: string | null;
  memo?: string | null;
  location?: string | number | null;
  location_name?: string | null;
  subsidiary?: string | number | null;
  subsidiary_name?: string | null;
  currency?: string | number | null;
  currency_name?: string | null;
  total_amount?: string | number | null;
  last_modified?: string | null;
  datecreated?: string | null;
  items?: OracleSalesOrderItem[];
}

interface OracleSalesOrdersResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleSalesOrder[];
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
  unchanged: number;
  failed: number;
  durationMs: number;
}

@Injectable()
export class SalesOrderSyncService {
  private readonly logger = new Logger(SalesOrderSyncService.name);

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
  ): Promise<OracleSalesOrdersResponse> {
    // All statuses are pulled; status filtering happens in WMS, not Oracle.
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/sales-orders/get`, {
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
        is_sync: false,
        filters,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Sales orders fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as OracleSalesOrdersResponse;
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
        ? `Starting incremental sales order sync (since ${lastModified})`
        : `Starting FULL sales order sync (pageSize=${pageSize})`,
    );

    const token = await this.getAccessToken();
    let page = 1;
    let totalPages = 1;
    let totalRecords = 0;
    let upserted = 0;
    let unchanged = 0;
    let failed = 0;

    do {
      if (page > 1 && pageDelayMs > 0) await this.delay(pageDelayMs);

      const res = await this.fetchPage(token, page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const so of res.data ?? []) {
        try {
          const changed = await this.upsert(so);
          if (changed) upserted++;
          else unchanged++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert sales order id=${so.id}: ${(e as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Page ${page}/${totalPages} — upserted=${upserted}, unchanged=${unchanged}`,
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
      unchanged,
      failed,
      durationMs: Date.now() - start,
    };
    this.logger.log(`Sales order sync done: ${JSON.stringify(result)}`);
    return result;
  }

  // Upsert one sales order header + its items. Returns false when the record
  // was already up to date (same last_modified) and nothing was written.
  private async upsert(so: OracleSalesOrder): Promise<boolean> {
    const oracleId = String(so.id);
    const newLm = so.last_modified ? new Date(so.last_modified) : null;

    // Header write is gated on last_modified (avoids churn), BUT detail items are
    // ALWAYS reconciled 1:1 below — Oracle can change item-level data (e.g.
    // `shipped` from a fulfillment) without bumping the SO header timestamp, so
    // skipping items when the header is unchanged leaves details stale.
    const existing = await this.prisma.salesOrder.findUnique({
      where: { oracleId },
      select: { id: true, lastModified: true },
    });
    const headerChanged = !(
      existing &&
      newLm &&
      existing.lastModified &&
      existing.lastModified.getTime() === newLm.getTime()
    );

    // Resolve header location -> WMS warehouse (by Oracle id) for scoping.
    let warehouseId: string | null = null;
    if (so.location != null) {
      const wh = await this.prisma.warehouse.findUnique({
        where: { oracleId: String(so.location) },
        select: { id: true },
      });
      warehouseId = wh?.id ?? null;
    }

    const header = {
      tranId: so.tranid ?? null,
      tranDate: so.tran_date ?? null,
      statusCode: so.status_code ?? null,
      statusName: so.status_name ?? null,
      customerId: so.customer_id != null ? String(so.customer_id) : null,
      customerName: so.customer_name ?? null,
      memo: so.memo ?? null,
      locationOracleId: so.location != null ? String(so.location) : null,
      locationName: so.location_name ?? null,
      warehouseId,
      subsidiaryId: so.subsidiary != null ? String(so.subsidiary) : null,
      subsidiaryName: so.subsidiary_name ?? null,
      currencyId: so.currency != null ? String(so.currency) : null,
      currencyName: so.currency_name ?? null,
      totalAmount: this.toNumber(so.total_amount),
      lastModified: newLm && !isNaN(newLm.getTime()) ? newLm : null,
      dateCreated: so.datecreated ?? null,
    };

    let touched = headerChanged;
    await this.prisma.$transaction(async (tx) => {
      // Write the header only when it changed; otherwise reuse the existing row.
      const record = headerChanged
        ? await tx.salesOrder.upsert({
            where: { oracleId },
            update: header,
            create: { oracleId, createdBy: 'ERP Sync', ...header },
          })
        : existing!;

      // Upsert details by (salesOrderId, lineNumber) — no duplicates, header-
      // detail relation preserved, and WMS-managed remainingQty/picking links
      // survive incremental re-syncs (only set on first insert).
      for (const it of so.items ?? []) {
        if (it.line_number == null) continue;
        // item_id -> materials.erp_doc_id
        let materialId: string | null = null;
        if (it.item_id != null) {
          const mat = await tx.material.findUnique({
            where: { erpDocId: String(it.item_id) },
            select: { id: true },
          });
          materialId = mat?.id ?? null;
        }
        const quantity = this.toNumber(it.quantity);
        const shipped = this.toNumber(it.shipped);
        const itemData = {
          itemOracleId: it.item_id != null ? String(it.item_id) : null,
          itemName: it.item_name ?? null,
          materialId,
          quantity,
          rate: this.toNumber(it.rate),
          amount: this.toNumber(it.amount),
          shipped,
          description: it.description ?? null,
          locationId: it.location_id != null ? String(it.location_id) : null,
        };

        // Remaining-to-pick = quantity - shipped. Recompute this only when the
        // Oracle `shipped` changes (e.g. SO moves to Partially Fulfilled after a
        // partial shipment); otherwise preserve the WMS-managed value so in-
        // progress Generate Picking decrements are not clobbered every sync.
        const prev = await tx.salesOrderItem.findUnique({
          where: {
            salesOrderId_lineNumber: {
              salesOrderId: record.id,
              lineNumber: it.line_number,
            },
          },
          select: { shipped: true },
        });
        const shippedChanged = !prev || prev.shipped !== shipped;
        if (shippedChanged) touched = true;
        const remainingQty = Math.max(0, quantity - shipped);

        await tx.salesOrderItem.upsert({
          where: {
            salesOrderId_lineNumber: {
              salesOrderId: record.id,
              lineNumber: it.line_number,
            },
          },
          update: shippedChanged ? { ...itemData, remainingQty } : itemData,
          create: {
            salesOrderId: record.id,
            lineNumber: it.line_number,
            remainingQty,
            ...itemData,
          },
        });
      }
    });

    return touched;
  }

  private toNumber(v: unknown): number {
    if (v == null) return 0;
    const n = typeof v === 'number' ? v : Number(v);
    return isNaN(n) ? 0 : n;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
