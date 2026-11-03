import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';

interface OracleCrLine {
  item?: string | number | null;
  line?: string | number | null;
  line_id?: string | number | null;
  units?: string | null;
  closed?: boolean | null;
  quantity?: number | string | null;
  received?: number | string | null;
  description?: string | null;
  item_display?: string | null;
  location?: string | number | null;
  location_display?: string | null;
  class_display?: string | null;
  department_display?: string | null;
}

interface OracleCr {
  id: string | number;
  tranid?: string | null;
  tran_date?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  memo?: string | null;
  customer_id?: string | number | null;
  customer_name?: string | null;
  createdfrom?: string | number | null;
  createdfrom_display?: string | null;
  otherrefnum?: string | null;
  subsidiary?: string | number | null;
  subsidiary_display?: string | null;
  class_display?: string | null;
  department_display?: string | null;
  location?: string | number | null;
  location_display?: string | null;
  datecreated?: string | null;
  last_modified?: string | null;
  items?: OracleCrLine[];
}

interface OracleCrResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: OracleCr[];
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

/** Oracle's "2026-10-01T00:00:00+07:00" (the bridge wants +07:00, not Z). */
function wibIso(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const t = new Date(d.getTime() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}+07:00`;
}

/**
 * Mirrors Oracle Customer Returns (Return Authorizations, "customers/returns")
 * into WMS — every status, like the PO sync; what can be received is decided
 * in WMS at Generate GR List.
 */
@Injectable()
export class CustomerReturnSyncService {
  private readonly logger = new Logger(CustomerReturnSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private erp: ErpHttpService,
  ) {}

  private fetchPage(page: number, pageSize: number, lastModified?: string): Promise<OracleCrResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = wibIso(lastModified);
    return this.erp.post<OracleCrResponse>('/customers/returns', {
      page,
      page_size: pageSize,
      sort_by: 'lastmodifieddate',
      sort_order: 'DESC',
      filters,
    });
  }

  // Refresh ONE return (header + lines) by its Oracle id: an item receipt
  // changes the lines' received qty, which the incremental sync may not see.
  async syncOne(oracleId: string): Promise<boolean> {
    const res = await this.erp.post<OracleCrResponse>('/customers/returns', {
      page: 1,
      page_size: 1,
      sort_by: 'lastmodifieddate',
      sort_order: 'DESC',
      filters: { netsuite_id: [oracleId] },
    });
    const cr = (res?.data ?? [])[0];
    if (!cr || cr.id == null || String(cr.id) !== String(oracleId)) {
      this.logger.warn(`syncOne: Customer Return ${oracleId} not returned by the bridge`);
      return false;
    }
    await this.upsert(cr);
    this.logger.log(`syncOne: Customer Return ${oracleId} refreshed (header + lines)`);
    return true;
  }

  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const start = Date.now();
    const pageSize = Math.min(options.pageSize ?? Number(this.config.get('ERP_SYNC_PAGE_SIZE') ?? 200), 200);
    const pageDelayMs = Number(this.config.get('ERP_SYNC_PAGE_DELAY_MS') ?? 1500);
    const lastModified = options.lastModified;

    this.logger.log(
      lastModified
        ? `Starting incremental Customer Return sync (since ${lastModified})`
        : `Starting FULL Customer Return sync (pageSize=${pageSize})`,
    );

    let page = 1;
    let totalPages: number;
    let totalRecords: number;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    do {
      if (page > 1 && pageDelayMs > 0) await this.delay(pageDelayMs);

      const res = await this.fetchPage(page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const cr of res.data ?? []) {
        if (cr.id == null || String(cr.id).trim() === '') {
          skipped++;
          continue;
        }
        try {
          await this.upsert(cr);
          upserted++;
        } catch (e) {
          failed++;
          this.logger.warn(`Failed to upsert Customer Return id=${cr.id}: ${(e as Error).message}`);
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
    this.logger.log(`Customer Return sync done: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsert(cr: OracleCr): Promise<void> {
    const oracleId = String(cr.id);
    const lm = cr.last_modified ? new Date(cr.last_modified) : null;
    const str = (v: string | number | null | undefined) => (v != null && v !== '' ? String(v) : null);

    // Header location -> WMS warehouse (by Oracle id) for scoping.
    let warehouseId: string | null = null;
    if (cr.location != null) {
      const wh = await this.prisma.warehouse.findUnique({ where: { oracleId: String(cr.location) }, select: { id: true } });
      warehouseId = wh?.id ?? null;
    }

    const header = {
      tranId: cr.tranid ?? null,
      tranDate: cr.tran_date ?? null,
      statusCode: cr.status_code ?? null,
      statusName: cr.status_name ?? null,
      memo: cr.memo ?? null,
      customerId: str(cr.customer_id),
      customerName: cr.customer_name ?? null,
      createdFromId: str(cr.createdfrom),
      createdFromDisplay: cr.createdfrom_display ?? null,
      otherRefNum: cr.otherrefnum ?? null,
      subsidiaryId: str(cr.subsidiary),
      subsidiaryDisplay: cr.subsidiary_display ?? null,
      classDisplay: cr.class_display ?? null,
      departmentDisplay: cr.department_display ?? null,
      locationOracleId: str(cr.location),
      locationName: cr.location_display ?? null,
      dateCreated: cr.datecreated ?? null,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
      warehouseId,
    };

    // Sequential writes, no interactive transaction (as the PO sync): a
    // partial write is reconciled on the next run.
    const record = await this.prisma.customerReturn.upsert({
      where: { oracleId },
      update: header,
      create: { oracleId, createdBy: 'ERP Sync', ...header },
    });

    for (const ln of cr.items ?? []) {
      if (ln.line_id == null) continue;
      const lineId = String(ln.line_id);

      let materialId: string | null = null;
      if (ln.item != null) {
        const mat = await this.prisma.material.findUnique({ where: { erpDocId: String(ln.item) }, select: { id: true } });
        materialId = mat?.id ?? null;
      }

      const lineData = {
        lineNumber: ln.line != null && !Number.isNaN(Number(ln.line)) ? Number(ln.line) : null,
        itemOracleId: str(ln.item),
        itemDisplay: ln.item_display ?? null,
        description: ln.description || null,
        units: ln.units ?? null,
        quantity: this.toNumber(ln.quantity),
        received: this.toNumber(ln.received),
        closed: !!ln.closed,
        locationOracleId: str(ln.location),
        locationName: ln.location_display ?? null,
        departmentDisplay: ln.department_display ?? null,
        classDisplay: ln.class_display ?? null,
        materialId,
      };

      await this.prisma.customerReturnLine.upsert({
        where: { customerReturnId_lineId: { customerReturnId: record.id, lineId } },
        update: lineData,
        create: { customerReturnId: record.id, lineId, ...lineData },
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
