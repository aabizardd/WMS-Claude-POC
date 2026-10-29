import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { DiscrepancyService } from '../discrepancy/discrepancy.service';
import { loadPibMrn } from './gr-source.util';
import { MrnSyncService } from '../mrn/mrn-sync.service';
import { inScope } from '../common/warehouse-scope';

interface WarehouseScope {
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface ReceiveItem {
  line_id: number;
  item: number;
  po_id: number;
}

interface ReceivePayload {
  idInboundShipment: number;
  items: ReceiveItem[];
}

interface GoodsReceiptItem {
  item_id: string;
  item_name: string;
}

interface GoodsReceipt {
  id: string;
  tranid: string;
  trandate: string;
  po_id: string;
  po_number: string;
  items: GoodsReceiptItem[];
}

interface ReceiveResponse {
  success: boolean;
  inbound_shipment_id: number;
  inbound_shipment_status: string;
  goods_receipts: GoodsReceipt[];
  isProcess: string;
}

@Injectable()
export class GoodsReceiveReceiveService {
  private readonly logger = new Logger(GoodsReceiveReceiveService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private inventory: InventoryService,
    private discrepancy: DiscrepancyService,
    private mrnSync: MrnSyncService,
  ) {}

  private baseUrl() {
    const url = this.config.get<string>('ERP_BASE_URL');
    if (!url) throw new Error('ERP_BASE_URL is not configured');
    return url.replace(/\/$/, '');
  }

  private async getAccessToken(): Promise<string> {
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

  async startReceive(
    id: string,
    scope: WarehouseScope,
  ): Promise<{ accepted: boolean }> {
    const gr = await this.prisma.goodsReceive.findUnique({ where: { id } });
    if (
      !gr ||
      (scope.role !== 'admin' && !inScope(scope, gr.warehouseId))
    ) {
      throw new NotFoundException(`Goods Receive ${id} not found`);
    }
    if (
      gr.status !== 'Open' &&
      gr.status !== 'Syncing' &&
      gr.status !== 'SyncFailed'
    ) {
      throw new Error(
        `Cannot receive: GR status is "${gr.status}" (expected Open or Syncing)`,
      );
    }
    const mrn = await loadPibMrn(this.prisma, gr);
    if (!mrn) {
      throw new Error('Only a PIB Goods Receive can trigger an Oracle receive');
    }
    if (!mrn.oracleId) {
      throw new Error('MRN has no Oracle ID — cannot trigger receive');
    }
    if (Number.isNaN(Number(mrn.oracleId))) {
      throw new Error(`MRN oracle_id "${mrn.oracleId}" is not a valid number`);
    }

    await this.prisma.goodsReceive.update({
      where: { id },
      data: { status: 'Syncing' },
    });

    return { accepted: true };
  }

  /** Re-sync the GR's source inbound shipment (MRN) from Oracle. */
  private async refreshMrn(grId: string) {
    try {
      const gr = await this.prisma.goodsReceive.findUnique({
        where: { id: grId },
        select: { sourceType: true, sourceDocId: true },
      });
      if (gr?.sourceType !== 'PIB') return;
      const mrn = await this.prisma.mrn.findUnique({
        where: { id: gr.sourceDocId },
        select: { oracleId: true },
      });
      if (mrn?.oracleId) await this.mrnSync.syncOne(mrn.oracleId);
    } catch (e) {
      this.logger.warn(`MRN refresh after receipt failed for GR ${grId}: ${(e as Error).message}`);
    }
  }

  async processInBackground(id: string): Promise<void> {
    try {
      const gr = await this.prisma.goodsReceive.findUnique({ where: { id } });
      if (!gr) return;

      const mrn = await loadPibMrn(this.prisma, gr);
      if (!mrn) return;
      const idInboundShipment = Number(mrn.oracleId);

      const items: ReceiveItem[] = [];
      for (const it of mrn.items) {
        if (it.lineId == null || it.itemId == null || it.poId == null) {
          this.logger.warn(
            `Skipping MRN item ${it.id}: missing line_id/item_id/po_id`,
          );
          continue;
        }
        items.push({
          line_id: it.lineId,
          item: it.itemId,
          po_id: it.poId,
        });
      }

      if (items.length === 0) {
        this.logger.error(`No valid MRN items for GR ${id}`);
        return;
      }

      const payload: ReceivePayload = { idInboundShipment, items };
      const token = await this.getAccessToken();
      const maxAttempts = 30;
      const pollDelayMs = 2000;
      let rateLimitCount = 0;
      let serverErrorCount = 0;
      const maxRateLimitRetries = 5;
      const maxServerErrorRetries = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          await this.delay(pollDelayMs);
        }

        let res: Response;
        try {
          res = await fetch(
            `${this.baseUrl()}/inbound-shipments/receive`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(payload),
            },
          );
        } catch {
          serverErrorCount++;
          this.logger.warn(
            `Network error on attempt ${attempt} (server error ${serverErrorCount}/${maxServerErrorRetries})`,
          );
          if (serverErrorCount <= maxServerErrorRetries) {
            await this.delay(2_000);
            continue;
          }
          this.logger.error(
            `ERP receive failed after ${maxServerErrorRetries} network errors — GR ${id} stays Syncing`,
          );
          return;
        }

        if (!res.ok) {
          if (res.status === 429) {
            rateLimitCount++;
            this.logger.warn(
              `Rate limited (429) on attempt ${attempt} (rate limit ${rateLimitCount}/${maxRateLimitRetries})`,
            );
            if (rateLimitCount <= maxRateLimitRetries) {
              await this.delay(10_000);
              continue;
            }
            this.logger.error(
              `ERP receive failed after ${maxRateLimitRetries} rate limits — GR ${id} stays Syncing`,
            );
            return;
          }

          if (res.status >= 500) {
            serverErrorCount++;
            this.logger.warn(
              `Server error ${res.status} on attempt ${attempt} (error ${serverErrorCount}/${maxServerErrorRetries})`,
            );
            if (serverErrorCount <= maxServerErrorRetries) {
              await this.delay(2_000);
              continue;
            }
            this.logger.error(
              `ERP receive failed after ${maxServerErrorRetries} server errors — GR ${id} stays Syncing`,
            );
            return;
          }

          this.logger.error(
            `ERP receive failed on attempt ${attempt}: ${res.status} ${await res.text()}`,
          );
          return;
        }

        const json = (await res.json()) as ReceiveResponse;

        if (
          json.goods_receipts?.length > 0 &&
          json.inbound_shipment_status === 'received'
        ) {
          this.logger.log(
            `Receive succeeded on attempt ${attempt} — ${json.goods_receipts.length} goods receipt(s)`,
          );
          await this.prisma.goodsReceive.update({
            where: { id },
            data: { status: 'OnProgress' },
          });
          // Record received goods into inventory (idempotent).
          try {
            await this.inventory.generateFromGoodsReceive(id);
          } catch (e) {
            this.logger.error(
              `Inventory generation failed for GR ${id}: ${(e as Error).message}`,
            );
          }
          // Record quantity discrepancy for items received short.
          try {
            await this.discrepancy.recordFromGoodsReceive(id);
          } catch (e) {
            this.logger.error(
              `Discrepancy recording failed for GR ${id}: ${(e as Error).message}`,
            );
          }
          // Pull the shipment back from Oracle so its status / received
          // quantities match the receipt. Non-fatal.
          await this.refreshMrn(id);
          return;
        }

        this.logger.log(
          `Polling attempt ${attempt}/${maxAttempts} — status: ${json.inbound_shipment_status}, ` +
            `goods_receipts: ${json.goods_receipts?.length ?? 0}`,
        );
      }

      await this.prisma.goodsReceive.update({
        where: { id },
        data: { status: 'SyncFailed' },
      });
      this.logger.warn(
        `Receive timed out after ${maxAttempts} attempts — GR ${id} set to Sync Failed`,
      );
    } catch (err) {
      this.logger.error(
        `Background receive failed for GR ${id}: ${(err as Error).message}`,
      );
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
