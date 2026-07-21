import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';

interface OraclePoLine {
  item?: string | number | null;
  line_id?: string | number | null;
  linesequencenumber?: string | number | null;
  itemtype?: string | null;
  quantity?: number | string | null;
  committed?: number | string | null;
  backordered?: number | string | null;
  quantityreceived?: number | string | null;
  quantitybilled?: number | string | null;
  description?: string | null;
  item_display?: string | null;
  class_display?: string | null;
  location?: string | number | null;
  location_display?: string | null;
  department_display?: string | null;
  inbound_shipment_number?: string | null;
  inbound_shipment_line_id?: number | null;
}

interface OraclePo {
  po_id: string | number;
  po_number?: string | null;
  po_date?: string | null;
  po_status?: string | null;
  po_status_label?: string | null;
  memo?: string | null;
  vendor_id?: number | null;
  vendor_name?: string | null;
  currency_id?: number | null;
  currency_symbol?: string | null;
  approvalstatus?: number | null;
  approvalstatus_display?: string | null;
  subsidiary?: string | number | null;
  subsidiary_display?: string | null;
  class_display?: string | null;
  department_display?: string | null;
  location?: string | number | null;
  location_display?: string | null;
  created_by_netsuite?: string | null;
  datecreated?: string | null;
  last_modified?: string | null;
  lines?: OraclePoLine[];
}

interface OraclePoResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OraclePo[];
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
export class PurchaseOrderSyncService {
  private readonly logger = new Logger(PurchaseOrderSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private erp: ErpHttpService,
  ) {}

  private fetchPage(
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<OraclePoResponse> {
    // All PO statuses are pulled into WMS; status filtering happens in WMS, not
    // Oracle (the receivable-only rule is enforced later at Goods Receive).
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;
    return this.erp.post<OraclePoResponse>('/purchase-orders/get-list', {
      page,
      page_size: pageSize,
      sort_by: 'lastmodifieddate',
      sort_order: 'desc',
      filters,
    });
  }

  // Refresh ONE PO (header + lines) from the bridge by its Oracle id. Needed
  // because Oracle does NOT bump the PO's lastmodified when an item receipt
  // changes line quantities — the incremental (lastmodified-filtered) sync
  // skips such POs and their lines go stale.
  async syncOne(poOracleId: string): Promise<boolean> {
    const res = await this.erp.post<OraclePoResponse>('/purchase-orders/get-list', {
      page: 1,
      page_size: 1,
      sort_by: 'lastmodifieddate',
      sort_order: 'desc',
      filters: { po_id: poOracleId },
    });
    const po = (res?.data ?? [])[0];
    if (!po || po.po_id == null || String(po.po_id) !== String(poOracleId)) {
      this.logger.warn(`syncOne: PO ${poOracleId} not returned by the bridge`);
      return false;
    }
    await this.upsert(po);
    this.logger.log(`syncOne: PO ${poOracleId} refreshed (header + lines)`);
    return true;
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
        ? `Starting incremental PO sync (since ${lastModified})`
        : `Starting FULL PO sync (pageSize=${pageSize})`,
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

      for (const po of res.data ?? []) {
        // Skip malformed bridge records (no po_id → cannot key/store them;
        // these come through with po_status "failed").
        if (po.po_id == null || String(po.po_id).trim() === '') {
          skipped++;
          continue;
        }
        try {
          await this.upsert(po);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert PO id=${po.po_id}: ${(e as Error).message}`,
          );
        }
      }
      this.logger.log(`Page ${page}/${totalPages} — upserted=${upserted}, skipped=${skipped}`);
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
    this.logger.log(`PO sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(po: OraclePo): Promise<void> {
    const oracleId = String(po.po_id);
    const lm = po.last_modified ? new Date(po.last_modified) : null;

    // Resolve header location -> WMS warehouse (by Oracle id) for scoping.
    let warehouseId: string | null = null;
    if (po.location != null) {
      const wh = await this.prisma.warehouse.findUnique({
        where: { oracleId: String(po.location) },
        select: { id: true },
      });
      warehouseId = wh?.id ?? null;
    }

    const header = {
      poNumber: po.po_number ?? null,
      poDate: po.po_date ?? null,
      poStatus: po.po_status ?? null,
      poStatusLabel: po.po_status_label ?? null,
      memo: po.memo ?? null,
      vendorId: po.vendor_id ?? null,
      vendorName: po.vendor_name ?? null,
      currencyId: po.currency_id ?? null,
      currencySymbol: po.currency_symbol ?? null,
      approvalStatus: po.approvalstatus ?? null,
      approvalStatusDisplay: po.approvalstatus_display ?? null,
      subsidiaryId: po.subsidiary != null ? String(po.subsidiary) : null,
      subsidiaryDisplay: po.subsidiary_display ?? null,
      classDisplay: po.class_display ?? null,
      departmentDisplay: po.department_display ?? null,
      locationOracleId: po.location != null ? String(po.location) : null,
      locationName: po.location_display ?? null,
      createdByNetsuite: po.created_by_netsuite ?? null,
      dateCreated: po.datecreated ?? null,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
      warehouseId,
    };

    // No interactive transaction: POs can have many lines and each line does a
    // material lookup + upsert; wrapping them exceeds Prisma's 5s tx timeout.
    // Like the MRN sync, writes are sequential — a sync mirror is self-healing
    // (a partial write is reconciled on the next run).
    const record = await this.prisma.purchaseOrder.upsert({
      where: { oracleId },
      update: header,
      create: { oracleId, createdBy: 'ERP Sync', ...header },
    });

    for (const ln of po.lines ?? []) {
      if (ln.line_id == null) continue;
      const lineId = String(ln.line_id);

      // item -> materials.erp_doc_id
      let materialId: string | null = null;
      if (ln.item != null) {
        const mat = await this.prisma.material.findUnique({
          where: { erpDocId: String(ln.item) },
          select: { id: true },
        });
        materialId = mat?.id ?? null;
      }

      const lineData = {
        // Oracle line number (1..n) — sent as "line" in the item-receipt call.
        lineNumber:
          ln.linesequencenumber != null ? Number(ln.linesequencenumber) : null,
        itemOracleId: ln.item != null ? String(ln.item) : null,
        itemDisplay: ln.item_display ?? null,
        itemType: ln.itemtype ?? null,
        description: ln.description ?? null,
        quantity: this.toNumber(ln.quantity),
        committed: this.toNumber(ln.committed),
        backordered: this.toNumber(ln.backordered),
        quantityReceived: this.toNumber(ln.quantityreceived),
        quantityBilled: this.toNumber(ln.quantitybilled),
        locationOracleId: ln.location != null ? String(ln.location) : null,
        locationName: ln.location_display ?? null,
        departmentDisplay: ln.department_display ?? null,
        classDisplay: ln.class_display ?? null,
        inboundShipmentNumber: ln.inbound_shipment_number ?? null,
        inboundShipmentLineId: ln.inbound_shipment_line_id ?? null,
        materialId,
      };

      // WMS-managed fields (qtyActual/binId/qtyRemaining/inventoriedAt) are set
      // only on first insert so an incremental re-sync never clobbers an
      // in-progress Goods Receive.
      await this.prisma.purchaseOrderLine.upsert({
        where: { purchaseOrderId_lineId: { purchaseOrderId: record.id, lineId } },
        update: lineData,
        create: { purchaseOrderId: record.id, lineId, ...lineData },
      });
    }
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
