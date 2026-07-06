import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string; token_type: string; expires_in: number };
}

interface ErpLocation {
  location?: string;
  qtyOnHand?: string | number;
  qtyOnOrder?: string | number;
  qtyAvailable?: string | number;
  qtyBackOrder?: string | number;
  qtyCommitted?: string | number;
  inventorylocationId?: string | number;
}

interface ErpItem {
  internalId: string;
  itemId: string;
  displayName: string;
  last_modified?: string;
  locations?: ErpLocation[];
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

  // Per-run caches (reset at the start of each sync) to avoid re-querying
  // warehouses / virtual bins for every item.
  private warehouseCache = new Map<string, string | null>();
  private virtualBinCache = new Map<string, string>();
  private virtualMaster: {
    areaTypeId: string;
    aisleId: string;
    shelfId: string;
  } | null = null;

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

    // Retry on 429 (rate limit) with exponential backoff, honoring Retry-After.
    const maxRetries = Number(this.config.get('ERP_SYNC_MAX_RETRIES') ?? 6);
    const baseBackoff = Number(
      this.config.get('ERP_SYNC_RETRY_BACKOFF_MS') ?? 5000,
    );

    for (let attempt = 0; ; attempt++) {
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

      if (res.ok) {
        return (await res.json()) as ErpItemsResponse;
      }

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : baseBackoff * Math.pow(2, attempt);
        this.logger.warn(
          `Rate limited on page ${page} (attempt ${attempt + 1}/${maxRetries}). Waiting ${wait}ms…`,
        );
        await this.delay(wait);
        continue;
      }

      throw new Error(
        `ERP items fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
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

    // Reset per-run caches (warehouses / virtual bins may change between runs).
    this.warehouseCache.clear();
    this.virtualBinCache.clear();
    this.virtualMaster = null;

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
          const material = await this.upsertItem(item);
          // Mirror per-location inventory quantities (best-effort; a location
          // failure must not fail the whole item upsert).
          if (material && item.locations?.length) {
            await this.syncItemInventory(material, item.locations);
          }
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

  private async upsertItem(
    item: ErpItem,
  ): Promise<{ id: string; materialCode: string }> {
    const erpDocId = String(item.internalId);
    const materialCode = item.itemId;
    const materialName = item.displayName ?? '';

    try {
      const m = await this.prisma.material.upsert({
        where: { erpDocId },
        update: { materialCode, materialName, modifiedBy: 'ERP Sync' },
        create: {
          erpDocId,
          materialCode,
          materialName,
          createdBy: 'ERP Sync',
          modifiedBy: 'ERP Sync',
        },
        select: { id: true, materialCode: true },
      });
      return m;
    } catch (e) {
      // A material with this code may already exist without an erp_doc_id
      // (e.g. created manually or seeded) — reconcile by linking the erp_doc_id.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const m = await this.prisma.material.update({
          where: { materialCode },
          data: { erpDocId, materialName, modifiedBy: 'ERP Sync' },
          select: { id: true, materialCode: true },
        });
        return m;
      }
      throw e;
    }
  }

  // ---------- inventory mirror (from item.locations) ----------

  private num(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Mirror each Oracle location's quantities into WMS inventory:
   *  - header (inventory_management): qtyCommitted / qtyOnOrder / qtyBackOrder
   *    are always refreshed from Oracle.
   *  - virtual bin available = Oracle available − (qty_issue + quality_issue),
   *    written ONLY while the material has not been manually adjusted into a
   *    physical (non-virtual) bin. Locations without a matching warehouse
   *    (oracle_id) are skipped.
   */
  private async syncItemInventory(
    material: { id: string; materialCode: string },
    locations: ErpLocation[],
  ) {
    for (const loc of locations) {
      const oracleId =
        loc.inventorylocationId != null ? String(loc.inventorylocationId) : '';
      if (!oracleId) continue;

      const warehouseId = await this.resolveWarehouse(oracleId);
      if (!warehouseId) continue; // unknown location -> skip

      const available = this.num(loc.qtyAvailable);
      const committed = this.num(loc.qtyCommitted);
      const onOrder = this.num(loc.qtyOnOrder);
      const backOrder = this.num(loc.qtyBackOrder);

      // Find-or-create the header row and always refresh Oracle header qtys.
      let inv = await this.prisma.inventoryManagement.findFirst({
        where: { materialCode: material.materialCode, warehouseId },
        select: { id: true, materialId: true },
      });
      if (!inv) {
        inv = await this.prisma.inventoryManagement.create({
          data: {
            materialCode: material.materialCode,
            materialId: material.id,
            warehouseId,
            qtyCommitted: committed,
            qtyOnOrder: onOrder,
            qtyBackOrder: backOrder,
          },
          select: { id: true, materialId: true },
        });
      } else {
        await this.prisma.inventoryManagement.update({
          where: { id: inv.id },
          data: {
            qtyCommitted: committed,
            qtyOnOrder: onOrder,
            qtyBackOrder: backOrder,
            ...(inv.materialId ? {} : { materialId: material.id }),
          },
        });
      }

      const virtualBinId = await this.resolveVirtualBin(warehouseId, oracleId);

      // Respect manual adjustments: if stock has been distributed to any
      // physical (non-virtual) bin, do not overwrite the available quantity.
      const stocks = await this.prisma.inventoryBinStock.findMany({
        where: { inventoryId: inv.id },
        select: {
          binId: true,
          availQty: true,
          qtyIssue: true,
          qualityIssue: true,
        },
      });
      const adjusted = stocks.some(
        (s) => s.binId !== virtualBinId && s.availQty !== 0,
      );
      if (adjusted) continue;

      // available into WMS = Oracle available − existing (qty issue + quality issue)
      const issues = stocks.reduce(
        (a, s) => a + s.qtyIssue + s.qualityIssue,
        0,
      );
      const availForWms = Math.max(0, available - issues);

      const existing = stocks.find((s) => s.binId === virtualBinId);
      if (existing) {
        await this.prisma.inventoryBinStock.update({
          where: {
            inventoryId_binId: { inventoryId: inv.id, binId: virtualBinId },
          },
          data: { availQty: availForWms },
        });
      } else {
        await this.prisma.inventoryBinStock.create({
          data: {
            inventoryId: inv.id,
            binId: virtualBinId,
            availQty: availForWms,
          },
        });
      }
    }
  }

  /** Resolve (and cache) a WMS warehouse id from an Oracle location id. */
  private async resolveWarehouse(oracleId: string): Promise<string | null> {
    if (this.warehouseCache.has(oracleId)) {
      return this.warehouseCache.get(oracleId) ?? null;
    }
    const wh = await this.prisma.warehouse.findUnique({
      where: { oracleId },
      select: { id: true },
    });
    const id = wh?.id ?? null;
    this.warehouseCache.set(oracleId, id);
    return id;
  }

  /** Ensure the shared virtual AreaType/Aisle/Shelf exist (created once). */
  private async ensureVirtualMaster() {
    if (this.virtualMaster) return this.virtualMaster;
    const areaType = await this.prisma.areaType.upsert({
      where: { areaTypeCode: 'VIRTUAL' },
      update: {},
      create: { areaTypeName: 'Virtual', areaTypeCode: 'VIRTUAL' },
      select: { id: true },
    });
    const aisle = await this.prisma.aisle.upsert({
      where: { aisleCode: 'VIRTUAL' },
      update: {},
      create: { aisleName: 'Virtual', aisleCode: 'VIRTUAL' },
      select: { id: true },
    });
    const shelf = await this.prisma.shelf.upsert({
      where: { shelfCode: 'VIRTUAL' },
      update: {},
      create: { shelfLabel: 'Virtual', shelfCode: 'VIRTUAL' },
      select: { id: true },
    });
    this.virtualMaster = {
      areaTypeId: areaType.id,
      aisleId: aisle.id,
      shelfId: shelf.id,
    };
    return this.virtualMaster;
  }

  /** Ensure (and cache) a per-warehouse virtual bin, return its id. */
  private async resolveVirtualBin(
    warehouseId: string,
    oracleId: string,
  ): Promise<string> {
    if (this.virtualBinCache.has(warehouseId)) {
      return this.virtualBinCache.get(warehouseId)!;
    }
    const binCode = `VIRTUAL-${oracleId}`;
    const master = await this.ensureVirtualMaster();
    const bin = await this.prisma.bin.upsert({
      where: { binCode },
      update: { isVirtual: true },
      create: {
        binLabel: 'Virtual',
        binCode,
        isVirtual: true,
        warehouseId,
        areaTypeId: master.areaTypeId,
        aisleId: master.aisleId,
        shelfId: master.shelfId,
        createdBy: 'ERP Sync',
      },
      select: { id: true },
    });
    this.virtualBinCache.set(warehouseId, bin.id);
    return bin.id;
  }
}
