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
import { openPlannedByPoLine } from '../purchase-orders/purchase-orders.service';
import { highestSeq } from '../common/doc-sequence';
import type { GenerateGrListFromPoDto } from './dto/generate-gr-from-po.dto';
import type { WarehouseScope } from './goods-receive.service';
import { inScope } from '../common/warehouse-scope';

// PO statuses that allow receiving.
export const RECEIVABLE_PO_STATUSES = ['pendingReceipt', 'pendingBillPartReceived', 'partiallyReceived'];

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
 * Goods Receive for a Purchase Order (Inbound from Local Vendor), in the two
 * steps WMS dev uses — the same as Transfer IN:
 *
 * 1. Generate GR List — an Open GR with the planned qty per PO line. Nothing
 *    goes to Oracle yet.
 * 2. Receive — the actual qty entered on the GR is submitted as an Oracle Item
 *    Receipt (transaction_type "purchase_order"). Only when Oracle accepts does
 *    the GR take Oracle's number and move to On Progress, ready for putaway.
 */
@Injectable()
export class GoodsReceiveFromPoService {
  private readonly logger = new Logger(GoodsReceiveFromPoService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
    private poSync: PurchaseOrderSyncService,
  ) {}

  /** Step 1: an Open GR with planned quantities. */
  async generateList(dto: GenerateGrListFromPoDto, scope: WarehouseScope & { userId?: number }) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: dto.purchaseOrderId },
      include: { lines: true },
    });
    if (!po || (scope.role !== 'admin' && !inScope(scope, po.warehouseId))) {
      throw new NotFoundException(`Purchase Order ${dto.purchaseOrderId} not found`);
    }
    if (!RECEIVABLE_PO_STATUSES.includes(po.poStatus ?? '')) {
      throw new BadRequestException(
        `Generate GR List is not allowed while the Purchase Order is "${po.poStatusLabel ?? po.poStatus ?? '—'}"`,
      );
    }
    if (!po.warehouseId) {
      throw new BadRequestException('Purchase Order has no warehouse mapped in WMS');
    }

    const openPlanned = await openPlannedByPoLine(this.prisma, po.lines.map((l) => l.id));
    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const row of dto.items) {
      const line = lineById.get(row.lineId);
      if (!line) throw new BadRequestException(`Line ${row.lineId} is not part of this PO`);
      const label = line.itemDisplay ?? row.lineId;
      if (seen.has(row.lineId)) {
        throw new BadRequestException(`Line "${label}" is selected more than once`);
      }
      seen.add(row.lineId);
      if (line.lineNumber == null) {
        throw new BadRequestException(`Line "${label}" has no line number — re-sync the PO from ERP first`);
      }
      // Same as the detail's Remain: ordered − (received + planned on Open GRs).
      const remain = line.quantity - line.quantityReceived - (openPlanned.get(line.id) ?? 0);
      if (row.plannedQty > remain + 1e-9) {
        throw new BadRequestException(
          `Planned qty (${row.plannedQty}) exceeds remain (${Math.max(0, remain)}) for "${label}"`,
        );
      }
    }

    const materials = await this.prisma.material.findMany({
      where: { id: { in: po.lines.map((l) => l.materialId).filter((x): x is string => !!x) } },
      select: { id: true, materialCode: true },
    });
    const codeById = new Map(materials.map((m) => [m.id, m.materialCode]));

    // Temporary number until Oracle gives the receipt its own on Receive.
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // Highest number in use, not a count: GR Lists can be deleted.
    const count = highestSeq(
      (
        await this.prisma.goodsReceive.findMany({
          where: { grNumber: { startsWith: `GR-${today}-` } },
          select: { grNumber: true },
        })
      ).map((g) => g.grNumber),
    );
    const grNumber = `GR-${today}-${String(count + 1).padStart(5, '0')}`;

    const gr = await this.prisma.goodsReceive.create({
      data: {
        sourceType: 'PO',
        sourceDocId: po.id,
        sourceDocNumber: po.poNumber ?? String(po.oracleId),
        grNumber,
        status: 'Open',
        warehouseId: po.warehouseId,
        createdById: scope.userId ?? null,
        items: {
          create: dto.items.map((row) => {
            const line = lineById.get(row.lineId)!;
            return {
              lineNumber: line.lineNumber,
              itemDisplay: line.itemDisplay,
              materialId: line.materialId,
              materialCode: line.materialId ? (codeById.get(line.materialId) ?? null) : null,
              qty: row.plannedQty,
              purchaseOrderLineId: line.id,
            };
          }),
        },
      },
    });
    this.logger.log(`GR List ${grNumber} generated from PO ${po.poNumber ?? po.oracleId}`);
    return { id: gr.id, gr_number: gr.grNumber, po_number: po.poNumber };
  }

  /** Step 2: submit the GR's actual quantities to Oracle as an Item Receipt. */
  async receive(grId: string, scope: WarehouseScope & { userId?: number }) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: grId },
      include: { items: true },
    });
    if (!gr || gr.sourceType !== 'PO' || (scope.role !== 'admin' && !inScope(scope, gr.warehouseId))) {
      throw new NotFoundException(`Goods Receive ${grId} not found`);
    }
    if (gr.status !== 'Open' && gr.status !== 'SyncFailed') {
      throw new BadRequestException(`Cannot receive: GR status is "${gr.status}"`);
    }
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: gr.sourceDocId } });
    if (!po?.oracleId) {
      throw new BadRequestException('Purchase Order has no ERP Doc ID — re-sync it from ERP first');
    }

    const lines = gr.items.filter((it) => it.qtyActual > 0);
    if (!lines.length) throw new BadRequestException('Enter the actual qty of at least one item');
    for (const it of lines) {
      const label = it.materialCode ?? it.itemDisplay ?? it.id;
      if (it.lineNumber == null) throw new BadRequestException(`"${label}" has no ERP line number`);
    }

    // Oracle first — this CREATES a real Item Receipt.
    const payload = {
      transaction_type: 'purchase_order',
      transaction_id: po.oracleId,
      items: lines.map((it) => ({ line: it.lineNumber!, quantity: it.qtyActual })),
    };
    this.logger.log(`[ItemReceipt] REQUEST ${JSON.stringify(payload)}`);
    let json: ItemReceiptResponse;
    try {
      json = await this.erp.post<ItemReceiptResponse>('/items/item-receipt', payload);
    } catch (e) {
      throw new ServiceUnavailableException(`Failed to reach Oracle Item Receipt: ${(e as Error).message}`);
    }
    this.logger.log(`[ItemReceipt] RESPONSE ${JSON.stringify(json)}`);
    if (!json?.success) {
      throw new ServiceUnavailableException(json?.message ?? 'Oracle Item Receipt failed');
    }
    const receipt = json.goods_receipts?.[0];
    const grNumber = receipt?.tranid ?? gr.grNumber;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.goodsReceive.update({
          where: { id: gr.id },
          // Received in Oracle: ready for putaway.
          data: { grNumber, status: 'OnProgress' },
        });
        // What is received is what can be put away.
        for (const it of lines) {
          await tx.goodsReceiveItem.update({
            where: { id: it.id },
            data: { qtyRemaining: it.qtyActual },
          });
        }
      });
    } catch (e) {
      // The Oracle receipt ALREADY exists — log what is needed to recover it.
      this.logger.error(
        `[ItemReceipt] ORPHANED RECEIPT: Oracle created ${grNumber} (receipt id ${receipt?.id ?? '—'}) for GR ${gr.grNumber} but the WMS update failed: ${(e as Error).message}. Payload: ${JSON.stringify(payload)}`,
      );
      throw new ServiceUnavailableException(
        `The Oracle receipt ${grNumber} was created, but saving it in WMS failed (${(e as Error).message}). Do NOT retry — contact an admin to recover the record.`,
      );
    }
    this.logger.log(`GR ${gr.grNumber} received as ${grNumber} (Oracle receipt id ${receipt?.id ?? '—'})`);

    // Refresh the PO right away: the receipt changes the lines' received qty
    // in Oracle WITHOUT bumping the PO's lastmodified, so the incremental sync
    // would never pick it up. Non-fatal — the GR is already saved.
    try {
      await this.poSync.syncOne(po.oracleId);
    } catch (e) {
      this.logger.warn(`PO ${po.oracleId} refresh after receipt failed: ${(e as Error).message}`);
    }
    return { accepted: true, gr_number: grNumber };
  }
}
