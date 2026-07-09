import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';

interface ErpLocation {
  location?: string;
  qtyOnHand?: string | number;
  qtyOnOrder?: string | number;
  qtyAvailable?: string | number;
  qtyBackOrder?: string | number;
  qtyCommitted?: string | number;
  qtyInTransit?: string | number;
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
  // Write per-location qty_available into inventory (virtual bin availQty).
  // Only the INITIAL inject should do this — the scheduler and the manual
  // "Sync from ERP" button must NOT touch qty_available (Oracle stays the
  // source of truth but availability is not re-synced on every run). The rest
  // (materials + header qtyCommitted/qtyOnOrder/qtyBackOrder) is always synced.
  syncAvailability?: boolean;
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
    private erp: ErpHttpService,
  ) {}

  /** Fetch a single page of items (shared client handles auth/throttle/429). */
  private fetchItemsPage(
    page: number,
    pageSize: number,
    lastModified?: string,
  ): Promise<ErpItemsResponse> {
    const filters: Record<string, string> = {};
    if (lastModified) filters.lastmodified = lastModified;
    return this.erp.post<ErpItemsResponse>('/items/get', {
      page,
      page_size: pageSize,
      sort_by: 'lastmodifieddate',
      sort_order: 'DESC',
      filters,
    });
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
    const writeAvailability = options.syncAvailability ?? false;

    this.logger.log(
      `${
        lastModified
          ? `Starting incremental ERP sync (lastModified=${lastModified}, pageSize=${pageSize})`
          : `Starting FULL ERP sync (pageSize=${pageSize})`
      }${writeAvailability ? ' [with qty_available]' : ' [no qty_available]'}`,
    );

    // Reset per-run caches (warehouses / virtual bins may change between runs).
    this.warehouseCache.clear();
    this.virtualBinCache.clear();
    this.virtualMaster = null;

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

      const res = await this.fetchItemsPage(page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const item of res.data ?? []) {
        try {
          const material = await this.upsertItem(item);
          // Mirror per-location inventory quantities (best-effort; a location
          // failure must not fail the whole item upsert).
          if (material && item.locations?.length) {
            await this.syncItemInventory(
              material,
              item.locations,
              writeAvailability,
            );
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
   *    written ONLY when `writeAvailability` is set (initial inject) AND the
   *    material has not been manually adjusted into a physical (non-virtual)
   *    bin. The scheduler / manual button pass writeAvailability = false so
   *    qty_available is never re-synced there. Locations without a matching
   *    warehouse (oracle_id) are skipped.
   */
  private async syncItemInventory(
    material: { id: string; materialCode: string },
    locations: ErpLocation[],
    writeAvailability: boolean,
  ) {
    for (const loc of locations) {
      const oracleId =
        loc.inventorylocationId != null ? String(loc.inventorylocationId) : '';
      if (!oracleId) continue;

      const warehouseId = await this.resolveWarehouse(oracleId);
      if (!warehouseId) continue; // unknown location -> skip

      const committed = this.num(loc.qtyCommitted);
      const onOrder = this.num(loc.qtyOnOrder);
      const backOrder = this.num(loc.qtyBackOrder);
      const inTransit = this.num(loc.qtyInTransit);

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
            qtyInTransit: inTransit,
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
            qtyInTransit: inTransit,
            ...(inv.materialId ? {} : { materialId: material.id }),
          },
        });
      }

      // qty_available is only written by the initial inject. The scheduler and
      // the manual "Sync from ERP" button skip it — header qtys above are still
      // refreshed. (Oracle stays the source of truth; availability is set once
      // at inject and thereafter only WMS issue/reserved adjustments apply.)
      if (!writeAvailability) continue;

      const available = this.num(loc.qtyAvailable);
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
