import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface PibItem {
  po_id?: number;
  item_id?: number;
  line_id?: number;
  po_rate?: number;
  item_name?: string | null;
  po_number?: string | null;
  vendor_id?: number;
  vendor_name?: string | null;
  qty_expected?: number;
  qty_received?: number;
  qty_remaining?: number;
  item_description?: string | null;
  shipment_item_amount?: number;
  receiving_location_id?: number | string | null;
  receiving_location_name?: string | null;
}

interface Pib {
  id: number | string;
  shipment_number?: string | null;
  external_doc_number?: string | null;
  external_id?: string | null;
  status?: string | null;
  expected_shipping_date?: string | null;
  actual_shipping_date?: string | null;
  expected_delivery_date?: string | null;
  actual_delivery_date?: string | null;
  memo?: string | null;
  vessel_number?: string | null;
  bill_of_lading?: string | null;
  date_created?: string | null;
  last_modified?: string | null;
  port?: string | null;
  items?: PibItem[];
}

interface PibResponse {
  success: boolean;
  total_records: number;
  total_pages: number;
  data: Pib[];
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
  goodsReceiveCreated: number;
  failed: number;
  durationMs: number;
}

@Injectable()
export class MrnSyncService {
  private readonly logger = new Logger(MrnSyncService.name);

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
  ): Promise<PibResponse> {
    // Only inbound shipments still in transit are injected.
    const filters: Record<string, string> = { status: 'inTransit' };
    if (lastModified) filters.lastmodified = lastModified;

    const res = await fetch(`${this.baseUrl()}/inbound-shipments/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        page,
        page_size: pageSize,
        sort_by: 'lastmodifieddate',
        sort_order: 'desc',
        filters,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Inbound shipments fetch failed (page ${page}): ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as PibResponse;
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
        ? `Starting incremental MRN sync (since ${lastModified})`
        : `Starting FULL MRN sync (pageSize=${pageSize})`,
    );

    const token = await this.getAccessToken();
    let page = 1;
    let totalPages = 1;
    let totalRecords = 0;
    let upserted = 0;
    let goodsReceiveCreated = 0;
    let failed = 0;

    do {
      if (page > 1 && pageDelayMs > 0) await this.delay(pageDelayMs);

      const res = await this.fetchPage(token, page, pageSize, lastModified);
      totalPages = res.total_pages || 1;
      totalRecords = res.total_records ?? 0;

      for (const pib of res.data ?? []) {
        try {
          const created = await this.upsert(pib);
          upserted++;
          if (created) goodsReceiveCreated++;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Failed to upsert PIB id=${pib.id}: ${(e as Error).message}`,
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
      goodsReceiveCreated,
      failed,
      durationMs: Date.now() - start,
    };
    this.logger.log(`MRN sync done: ${JSON.stringify(result)}`);
    return result;
  }

  // Returns true if a Goods Receive doc was newly created.
  private async upsert(pib: Pib): Promise<boolean> {
    const oracleId = String(pib.id);
    const firstItem = pib.items?.[0];
    const receivingLocationId =
      firstItem?.receiving_location_id != null
        ? String(firstItem.receiving_location_id)
        : null;
    const receivingLocationName = firstItem?.receiving_location_name ?? null;

    // Resolve receiving location -> WMS warehouse (by Oracle id) for scoping.
    let warehouseId: string | null = null;
    if (receivingLocationId) {
      const wh = await this.prisma.warehouse.findUnique({
        where: { oracleId: receivingLocationId },
        select: { id: true },
      });
      warehouseId = wh?.id ?? null;
    }

    const lm = pib.last_modified ? new Date(pib.last_modified) : null;

    const header = {
      shipmentNumber: pib.shipment_number ?? null,
      externalDocNumber: pib.external_doc_number ?? null,
      externalId: pib.external_id ?? null,
      oracleStatus: pib.status ?? null,
      status: 'Closed',
      expectedShippingDate: pib.expected_shipping_date ?? null,
      actualShippingDate: pib.actual_shipping_date ?? null,
      expectedDeliveryDate: pib.expected_delivery_date ?? null,
      actualDeliveryDate: pib.actual_delivery_date ?? null,
      memo: pib.memo ?? null,
      vesselNumber: pib.vessel_number ?? null,
      billOfLading: pib.bill_of_lading ?? null,
      port: pib.port ?? null,
      dateCreated: pib.date_created ?? null,
      lastModified: lm && !isNaN(lm.getTime()) ? lm : null,
      receivingLocationId,
      receivingLocationName,
      warehouseId,
    };

    const mrn = await this.prisma.mrn.upsert({
      where: { oracleId },
      update: header,
      create: { oracleId, createdBy: 'ERP Sync', ...header },
    });

    // Upsert line items, preserving any WMS-entered actual quantity.
    for (const it of pib.items ?? []) {
      if (it.line_id == null) continue;
      const itemData = {
        poId: it.po_id ?? null,
        itemId: it.item_id ?? null,
        poRate: it.po_rate ?? null,
        itemName: it.item_name ?? null,
        poNumber: it.po_number ?? null,
        vendorId: it.vendor_id ?? null,
        vendorName: it.vendor_name ?? null,
        itemDescription: it.item_description ?? null,
        qtyExpected: it.qty_expected ?? 0,
        qtyReceived: it.qty_received ?? 0,
        // qty_remaining is WMS-managed (starts 0, set to qty_actual at Goods Receive) — not from Oracle.
        shipmentItemAmount: it.shipment_item_amount ?? 0,
        receivingLocationId:
          it.receiving_location_id != null
            ? String(it.receiving_location_id)
            : null,
        receivingLocationName: it.receiving_location_name ?? null,
      };
      await this.prisma.mrnItem.upsert({
        where: { mrnId_lineId: { mrnId: mrn.id, lineId: it.line_id } },
        update: itemData, // qtyActual intentionally preserved
        create: { mrnId: mrn.id, lineId: it.line_id, qtyActual: 0, ...itemData },
      });
    }

    // Auto-create the Goods Receive doc (status Open) once per MRN.
    const existingGr = await this.prisma.goodsReceive.findUnique({
      where: { mrnId: mrn.id },
      select: { id: true },
    });
    if (!existingGr) {
      await this.prisma.goodsReceive.create({
        data: {
          mrnId: mrn.id,
          grNumber: `GR-${pib.shipment_number ?? oracleId}`,
          status: 'Open',
          warehouseId,
        },
      });
      return true;
    }
    return false;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
