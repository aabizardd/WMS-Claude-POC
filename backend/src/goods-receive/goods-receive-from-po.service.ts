import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';
import { PurchaseOrderSyncService } from '../purchase-orders/purchase-order-sync.service';
import type { GenerateGrFromPoDto } from './dto/generate-gr-from-po.dto';
import type { WarehouseScope } from './goods-receive.service';

// PO statuses that allow receiving.
const RECEIVABLE_PO_STATUSES = ['pendingReceipt', 'pendingBillPartReceived'];

interface ItemReceiptResponse {
  success: boolean;
  message?: string;
  goods_receipts?: {
    id?: number;
    tranid?: string;
    trandate?: string;
    source_type?: string;
    po_id?: string;
    po_number?: string;
  }[];
}

/**
 * Generate a Goods Receive from a Purchase Order (Inbound from Local Vendor).
 *
 * Submits an Item Receipt to Oracle first — nothing is persisted unless Oracle
 * accepts, so a failure leaves the PO untouched and the user can retry. On
 * success the GR is created with grNumber = Oracle's tranid and the submitted
 * lines are stored as GoodsReceiveItems (they are what the GR detail shows).
 */
@Injectable()
export class GoodsReceiveFromPoService {
  private readonly logger = new Logger(GoodsReceiveFromPoService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
    private poSync: PurchaseOrderSyncService,
  ) {}

  async generate(dto: GenerateGrFromPoDto, scope: WarehouseScope) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: dto.purchaseOrderId },
      include: { lines: true },
    });
    if (!po || (scope.role !== 'admin' && po.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Purchase Order ${dto.purchaseOrderId} not found`);
    }
    if (!RECEIVABLE_PO_STATUSES.includes(po.poStatus ?? '')) {
      throw new BadRequestException(
        `Generate GR is only allowed for status "Pending Receipt" or "Pending Billing/Partially Received" (current: ${po.poStatusLabel ?? po.poStatus ?? '—'})`,
      );
    }

    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const fulfillItems: { line: number; quantity: number }[] = [];
    for (const row of dto.items) {
      const line = lineById.get(row.lineId);
      if (!line) {
        throw new BadRequestException(`Line ${row.lineId} is not part of this PO`);
      }
      if (seen.has(row.lineId)) {
        throw new BadRequestException(
          `Line "${line.itemDisplay ?? row.lineId}" is selected more than once`,
        );
      }
      seen.add(row.lineId);
      if (line.lineNumber == null) {
        throw new BadRequestException(
          `Line "${line.itemDisplay ?? row.lineId}" has no line number — re-sync the PO from ERP first`,
        );
      }
      // Cap at outstanding = PO qty minus what Oracle already received.
      const outstanding = line.quantity - line.quantityReceived;
      if (row.qtyActual > outstanding + 1e-9) {
        throw new BadRequestException(
          `Actual qty (${row.qtyActual}) exceeds outstanding (${outstanding}) for "${line.itemDisplay ?? row.lineId}"`,
        );
      }
      fulfillItems.push({ line: line.lineNumber, quantity: row.qtyActual });
    }

    // Oracle first — this CREATES a real Item Receipt.
    const payload = {
      transaction_type: 'purchase_order',
      transaction_id: po.oracleId,
      items: fulfillItems,
    };
    this.logger.log(`[ItemReceipt] REQUEST ${JSON.stringify(payload)}`);
    let json: ItemReceiptResponse;
    try {
      const res = await this.erp.post<ItemReceiptResponse>('/items/item-receipt', payload);
      json = res;
    } catch (e) {
      throw new ServiceUnavailableException(
        `Failed to reach Oracle Item Receipt: ${(e as Error).message}`,
      );
    }
    this.logger.log(`[ItemReceipt] RESPONSE ${JSON.stringify(json)}`);
    if (!json?.success) {
      throw new ServiceUnavailableException(
        json?.message ?? 'Oracle Item Receipt failed',
      );
    }
    const receipt = json.goods_receipts?.[0];
    const grNumber =
      receipt?.tranid ??
      // Success without a tranid should not strand the receipt: fall back to a
      // generated number (the Oracle receipt already exists).
      `GR-PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now() % 100000}`;
    if (!receipt?.tranid) {
      this.logger.warn(
        `[ItemReceipt] success without tranid — falling back to generated GR number ${grNumber}`,
      );
    }

    let gr;
    try {
      gr = await this.prisma.goodsReceive.create({
        data: {
          sourceType: 'PO',
          sourceDocId: po.id,
          sourceDocNumber: po.poNumber ?? String(po.oracleId),
          grNumber,
          status: 'Open',
          warehouseId: po.warehouseId,
          items: {
            create: dto.items.map((row) => {
              const line = lineById.get(row.lineId)!;
              return {
                lineNumber: line.lineNumber,
                itemDisplay: line.itemDisplay,
                materialId: line.materialId,
                qty: row.qtyActual,
              };
            }),
          },
        },
      });
    } catch (e) {
      // The Oracle receipt ALREADY exists at this point — losing this insert
      // orphans it. Log everything needed to recover the record manually.
      this.logger.error(
        `[ItemReceipt] ORPHANED RECEIPT: Oracle created ${grNumber} (receipt id ${receipt?.id ?? '—'}) for PO ${po.poNumber ?? po.oracleId} but the WMS insert failed: ${(e as Error).message}. Payload: ${JSON.stringify(payload)}`,
      );
      throw new ServiceUnavailableException(
        `The Oracle receipt ${grNumber} was created, but saving it in WMS failed (${(e as Error).message}). Do NOT retry — contact an admin to recover the record.`,
      );
    }

    this.logger.log(
      `GR ${grNumber} generated from PO ${po.poNumber ?? po.oracleId} (${dto.items.length} line(s), Oracle receipt id ${receipt?.id ?? '—'})`,
    );

    // Refresh this PO from the bridge right away: the receipt changed the
    // line's quantityreceived/committed in Oracle WITHOUT bumping the PO's
    // lastmodified, so the incremental sync would never pick it up. Non-fatal —
    // the GR is already saved; a failed refresh only leaves the numbers stale.
    try {
      await this.poSync.syncOne(po.oracleId);
    } catch (e) {
      this.logger.warn(
        `PO ${po.oracleId} refresh after receipt failed (numbers may be stale until next full sync): ${(e as Error).message}`,
      );
    }
    return {
      id: gr.id,
      gr_number: gr.grNumber,
      oracle_receipt_id: receipt?.id ?? null,
      po_number: po.poNumber,
    };
  }
}
