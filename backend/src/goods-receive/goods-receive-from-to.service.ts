import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GenerateGrListFromToDto } from './dto/generate-gr-from-to.dto';
import type { WarehouseScope } from './goods-receive.service';

// TOs not fulfilled yet have nothing to receive.
const NOT_RECEIVABLE_TO_STATUSES = ['Pending Approval', 'Pending Fulfillment'];

interface ItemReceiptResponse {
  success: boolean;
  message?: string;
  goods_receipts?: {
    id?: number;
    tranid?: string;
    trandate?: string;
  }[];
}

/**
 * Goods Receive for a Transfer Order (Inbound from Transfer Stock), in the two
 * steps WMS dev uses:
 *
 * 1. Generate GR List — an Open GR with the planned qty per line. Nothing goes
 *    to Oracle yet.
 * 2. Receive — the actual qty (and receive bin) entered on the GR is submitted
 *    as an Oracle Item Receipt (transaction_type "transfer_order"). Only when
 *    Oracle accepts does the stock land in the bins, the GR take Oracle's
 *    number and move to On Progress, and the TO line's received qty go up
 *    (which takes it out of In Transit at the origin).
 */
@Injectable()
export class GoodsReceiveFromToService {
  private readonly logger = new Logger(GoodsReceiveFromToService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
    private inventory: InventoryService,
  ) {}

  /** Step 1: an Open GR with planned quantities. */
  async generateList(dto: GenerateGrListFromToDto, scope: WarehouseScope) {
    const to = await this.prisma.transferOrder.findUnique({
      where: { id: dto.transferOrderId },
      include: { items: true },
    });
    if (!to || (scope.role !== 'admin' && to.toWarehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Transfer Order ${dto.transferOrderId} not found`);
    }
    if (NOT_RECEIVABLE_TO_STATUSES.includes(to.statusName ?? '')) {
      throw new BadRequestException(
        `Generate GR List is not allowed while the Transfer Order is "${to.statusName}"`,
      );
    }
    const warehouseId = to.toWarehouseId;
    if (!warehouseId) {
      throw new BadRequestException('Transfer Order has no destination warehouse mapped in WMS');
    }

    const openPlanned = await this.openPlannedByLine(to.items.map((l) => l.id));
    const lineById = new Map(to.items.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const row of dto.items) {
      const line = lineById.get(row.lineId);
      if (!line) throw new BadRequestException(`Line ${row.lineId} is not part of this TO`);
      const label = line.itemName ?? row.lineId;
      if (seen.has(row.lineId)) {
        throw new BadRequestException(`Line "${label}" is selected more than once`);
      }
      seen.add(row.lineId);
      // Same as the detail's Remain: shipped − (received + planned on Open GRs).
      const remain = line.fulfilled - line.received - (openPlanned.get(line.id) ?? 0);
      if (row.plannedQty > remain + 1e-9) {
        throw new BadRequestException(
          `Planned qty (${row.plannedQty}) exceeds remain (${Math.max(0, remain)}) for "${label}"`,
        );
      }
    }

    const materials = await this.prisma.material.findMany({
      where: { id: { in: to.items.map((l) => l.materialId).filter((x): x is string => !!x) } },
      select: { id: true, materialCode: true },
    });
    const codeById = new Map(materials.map((m) => [m.id, m.materialCode]));

    // Temporary number until Oracle gives the receipt its own on Receive.
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.goodsReceive.count({
      where: { grNumber: { startsWith: `GR-${today}-` } },
    });
    const grNumber = `GR-${today}-${String(count + 1).padStart(5, '0')}`;

    const gr = await this.prisma.goodsReceive.create({
      data: {
        sourceType: 'TO',
        sourceDocId: to.id,
        sourceDocNumber: to.tranId ?? String(to.oracleId),
        grNumber,
        status: 'Open',
        warehouseId,
        items: {
          create: dto.items.map((row) => {
            const line = lineById.get(row.lineId)!;
            return {
              lineNumber: line.lineNumber,
              itemDisplay: line.itemName,
              materialId: line.materialId,
              materialCode: line.materialId ? (codeById.get(line.materialId) ?? null) : null,
              qty: row.plannedQty,
              transferOrderItemId: line.id,
            };
          }),
        },
      },
    });
    this.logger.log(`GR List ${grNumber} generated from TO ${to.tranId ?? to.oracleId}`);
    return { id: gr.id, gr_number: gr.grNumber, to_number: to.tranId };
  }

  /** Planned qty per TO line on GRs not received yet (Open / Sync Failed). */
  async openPlannedByLine(lineIds: string[]) {
    const rows = lineIds.length
      ? await this.prisma.goodsReceiveItem.findMany({
          where: { transferOrderItemId: { in: lineIds } },
          select: {
            transferOrderItemId: true,
            qty: true,
            qtyActual: true,
            goodsReceive: { select: { status: true } },
          },
        })
      : [];
    const byLine = new Map<string, number>();
    for (const r of rows) {
      if (!r.transferOrderItemId) continue;
      if (r.goodsReceive.status !== 'Open' && r.goodsReceive.status !== 'SyncFailed') continue;
      byLine.set(r.transferOrderItemId, (byLine.get(r.transferOrderItemId) ?? 0) + r.qty);
    }
    return byLine;
  }

  /** Step 2: submit the GR's actual quantities to Oracle and take them into stock. */
  async receive(grId: string, scope: WarehouseScope & { userId?: number }) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: grId },
      include: { items: { include: { transferOrderItem: true } } },
    });
    if (!gr || gr.sourceType !== 'TO' || (scope.role !== 'admin' && gr.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Goods Receive ${grId} not found`);
    }
    if (gr.status !== 'Open' && gr.status !== 'SyncFailed') {
      throw new BadRequestException(`Cannot receive: GR status is "${gr.status}"`);
    }
    const to = await this.prisma.transferOrder.findUnique({ where: { id: gr.sourceDocId } });
    if (!to?.oracleId) {
      throw new BadRequestException('Transfer Order has no ERP Doc ID — re-sync it from ERP first');
    }
    const warehouseId = gr.warehouseId;
    if (!warehouseId) throw new BadRequestException('Goods Receive has no warehouse');

    const lines = gr.items.filter((it) => it.qtyActual > 0);
    if (!lines.length) throw new BadRequestException('Enter the actual qty of at least one item');
    for (const it of lines) {
      const label = it.materialCode ?? it.itemDisplay ?? it.id;
      if (!it.binId) throw new BadRequestException(`Select the receive bin for "${label}"`);
      if (it.lineNumber == null) throw new BadRequestException(`"${label}" has no ERP line number`);
    }

    // Oracle first — this CREATES a real Item Receipt.
    const payload = {
      transaction_type: 'transfer_order',
      transaction_id: to.oracleId,
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
          // Received in Oracle and in stock: ready for putaway.
          data: { grNumber, status: 'OnProgress' },
        });
        for (const it of lines) {
          // What is received is what can be put away.
          await tx.goodsReceiveItem.update({
            where: { id: it.id },
            data: { qtyRemaining: it.qtyActual },
          });
          const materialCode = it.materialCode ?? it.itemDisplay ?? `ITEM-${it.id}`;
          // Find-or-create the destination inventory row, as a PIB receive does.
          let inv = await tx.inventoryManagement.findFirst({
            where: it.materialId ? { materialId: it.materialId, warehouseId } : { materialCode, warehouseId },
            select: { id: true },
          });
          if (!inv) {
            inv = await tx.inventoryManagement.create({
              data: { materialCode, materialId: it.materialId, warehouseId },
              select: { id: true },
            });
          }
          await this.inventory.adjustBinStock(
            inv.id,
            it.binId,
            { avail: it.qtyActual },
            {
              module: 'goods-receive',
              id: gr.id,
              number: grNumber,
              actorId: scope.userId,
              note: `Received from Transfer Order ${to.tranId ?? to.oracleId}`,
            },
            tx,
          );
          // Received at the destination: no longer in transit at the origin.
          if (it.transferOrderItemId) {
            await tx.transferOrderItem.update({
              where: { id: it.transferOrderItemId },
              data: { received: { increment: it.qtyActual } },
            });
          }
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
    return { accepted: true, gr_number: grNumber };
  }
}
