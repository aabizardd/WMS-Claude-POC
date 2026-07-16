import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';

interface OracleToItem {
  line_number?: number;
  item_id?: number | string | null;
  item_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  committed?: number | string | null;
  backordered?: number | string | null;
  shipped?: number | string | null;
  picked?: number | string | null;
  packed?: number | string | null;
  fulfilled?: number | string | null;
  received?: number | string | null;
  from_location_id?: number | string | null;
  from_location_name?: string | null;
}

interface OracleTransferOrder {
  id: number | string;
  tranid?: string | null;
  tran_date?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  from_location_id?: number | string | null;
  from_location_name?: string | null;
  to_location_id?: number | string | null;
  to_location_name?: string | null;
  memo?: string | null;
  last_modified?: string | null;
  datecreated?: string | null;
  items?: OracleToItem[];
}

interface OracleToResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleTransferOrder[];
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
  skipped: number;
  failed: number;
  durationMs: number;
}

@Injectable()
export class TransferOrderSyncService {
  private readonly logger = new Logger(TransferOrderSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private erp: ErpHttpService,
  ) {}

  private fetchPage(
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<OracleToResponse> {
    // All statuses pulled; WMS filters by status. Incremental via lastmodified.
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;
    return this.erp.post<OracleToResponse>('/transfer-orders/get', {
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
        ? `Starting incremental Transfer Order sync (since ${lastModified})`
        : `Starting FULL Transfer Order sync (pageSize=${pageSize})`,
    );

    let page = 1;
    let totalPages = 1;
    let totalRecords = 0;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    do {
      if (page > 1 && pageDelayMs > 0) await this.delay(pageDelayMs);

      const res = await this.fetchPage(page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const to of res.data ?? []) {
        if (to.id == null || String(to.id).trim() === '') {
          skipped++;
          continue;
        }
        try {
          await this.upsert(to);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert Transfer Order id=${to.id}: ${(e as Error).message}`,
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
      skipped,
      failed,
      durationMs: Date.now() - start,
    };
    this.logger.log(`Transfer Order sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(to: OracleTransferOrder): Promise<void> {
    const oracleId = String(to.id);
    const lm = to.last_modified ? new Date(to.last_modified) : null;

    const warehouseId = await this.resolveWarehouse(to.from_location_id);
    const toWarehouseId = await this.resolveWarehouse(to.to_location_id);

    const header = {
      tranId: to.tranid ?? null,
      tranDate: to.tran_date ?? null,
      statusCode: to.status_code ?? null,
      statusName: to.status_name ?? null,
      fromLocationOracleId:
        to.from_location_id != null ? String(to.from_location_id) : null,
      fromLocationName: to.from_location_name ?? null,
      warehouseId,
      toLocationOracleId:
        to.to_location_id != null ? String(to.to_location_id) : null,
      toLocationName: to.to_location_name ?? null,
      toWarehouseId,
      memo: to.memo ?? null,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
      dateCreated: to.datecreated ?? null,
    };

    // Sequential writes (no interactive tx) — a sync mirror is self-healing.
    const record = await this.prisma.transferOrder.upsert({
      where: { oracleId },
      update: header,
      create: { oracleId, createdBy: 'ERP Sync', ...header },
    });

    for (const it of to.items ?? []) {
      if (it.line_number == null) continue;
      let materialId: string | null = null;
      if (it.item_id != null) {
        const mat = await this.prisma.material.findUnique({
          where: { erpDocId: String(it.item_id) },
          select: { id: true },
        });
        materialId = mat?.id ?? null;
      }
      const itemData = {
        itemOracleId: it.item_id != null ? String(it.item_id) : null,
        itemName: it.item_name ?? null,
        description: it.description ?? null,
        quantity: this.toNumber(it.quantity),
        committed: this.toNumber(it.committed),
        backordered: this.toNumber(it.backordered),
        shipped: this.toNumber(it.shipped),
        picked: this.toNumber(it.picked),
        packed: this.toNumber(it.packed),
        fulfilled: this.toNumber(it.fulfilled),
        received: this.toNumber(it.received),
        fromLocationOracleId:
          it.from_location_id != null ? String(it.from_location_id) : null,
        fromLocationName: it.from_location_name ?? null,
        materialId,
      };
      await this.prisma.transferOrderItem.upsert({
        where: {
          transferOrderId_lineNumber: {
            transferOrderId: record.id,
            lineNumber: it.line_number,
          },
        },
        // remainingQty is WMS-managed (decremented on picking) — set it only on
        // first insert (= committed) so a re-sync never clobbers in-progress work.
        update: itemData,
        create: {
          transferOrderId: record.id,
          lineNumber: it.line_number,
          remainingQty: itemData.committed,
          ...itemData,
        },
      });
    }
  }

  private async resolveWarehouse(
    locationId?: number | string | null,
  ): Promise<string | null> {
    if (locationId == null) return null;
    const wh = await this.prisma.warehouse.findUnique({
      where: { oracleId: String(locationId) },
      select: { id: true },
    });
    return wh?.id ?? null;
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
