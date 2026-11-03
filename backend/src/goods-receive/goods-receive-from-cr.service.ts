import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';
import { CustomerReturnSyncService } from '../customer-returns/customer-return-sync.service';
import { RECEIVABLE_CR_STATUSES, openPlannedByCrLine } from '../customer-returns/customer-returns.service';
import { highestSeq } from '../common/doc-sequence';
import type { GenerateGrListFromCrDto } from './dto/generate-gr-from-cr.dto';
import type { WarehouseScope } from './goods-receive.service';
import { inScope } from '../common/warehouse-scope';

interface ItemReceiptResponse {
  success: boolean;
  message?: string;
  goods_receipts?: {
    id?: number;
    tranid?: string;
    trandate?: string;
    source_type?: string;
  }[];
}

/**
 * Goods Receive for a Customer Return (Inbound from Customer Return), in the
 * same two steps as Local Vendor:
 *
 * 1. Generate GR List — an Open GR with the planned qty per return line.
 *    Nothing goes to Oracle yet.
 * 2. Receive — the actual qty entered on the GR is submitted as an Oracle Item
 *    Receipt (transaction_type "customer_return"). Only when Oracle
 *    accepts does the GR take Oracle's number and move to On Progress, ready
 *    for putaway.
 */
@Injectable()
export class GoodsReceiveFromCrService {
  private readonly logger = new Logger(GoodsReceiveFromCrService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
    private crSync: CustomerReturnSyncService,
  ) {}

  /** Step 1: an Open GR with planned quantities. */
  async generateList(dto: GenerateGrListFromCrDto, scope: WarehouseScope & { userId?: number }) {
    const cr = await this.prisma.customerReturn.findUnique({
      where: { id: dto.customerReturnId },
      include: { lines: true },
    });
    if (!cr || (scope.role !== 'admin' && !inScope(scope, cr.warehouseId))) {
      throw new NotFoundException(`Customer Return ${dto.customerReturnId} not found`);
    }
    if (!RECEIVABLE_CR_STATUSES.includes(cr.statusCode ?? '')) {
      throw new BadRequestException(
        `Generate GR List is not allowed while the Customer Return is "${cr.statusName ?? cr.statusCode ?? '—'}"`,
      );
    }
    if (!cr.warehouseId) {
      throw new BadRequestException('Customer Return has no warehouse mapped in WMS');
    }

    const openPlanned = await openPlannedByCrLine(this.prisma, cr.lines.map((l) => l.id));
    const lineById = new Map(cr.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const row of dto.items) {
      const line = lineById.get(row.lineId);
      if (!line) throw new BadRequestException(`Line ${row.lineId} is not part of this Customer Return`);
      const label = line.itemDisplay ?? row.lineId;
      if (seen.has(row.lineId)) {
        throw new BadRequestException(`Line "${label}" is selected more than once`);
      }
      seen.add(row.lineId);
      if (line.lineNumber == null) {
        throw new BadRequestException(`Line "${label}" has no line number — re-sync the Customer Return from ERP first`);
      }
      if (line.closed) throw new BadRequestException(`Line "${label}" is closed in Oracle`);
      // Same as the detail's Remain: returned − (received + planned on Open GRs).
      const remain = line.quantity - line.received - (openPlanned.get(line.id) ?? 0);
      if (row.plannedQty > remain + 1e-9) {
        throw new BadRequestException(
          `Planned qty (${row.plannedQty}) exceeds remain (${Math.max(0, remain)}) for "${label}"`,
        );
      }
    }

    const materials = await this.prisma.material.findMany({
      where: { id: { in: cr.lines.map((l) => l.materialId).filter((x): x is string => !!x) } },
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
        sourceType: 'CUSTOMER_RETURN',
        sourceDocId: cr.id,
        sourceDocNumber: cr.tranId ?? String(cr.oracleId),
        grNumber,
        status: 'Open',
        warehouseId: cr.warehouseId,
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
              customerReturnLineId: line.id,
            };
          }),
        },
      },
    });
    this.logger.log(`GR List ${grNumber} generated from Customer Return ${cr.tranId ?? cr.oracleId}`);
    return { id: gr.id, gr_number: gr.grNumber, tran_id: cr.tranId };
  }

  /** Step 2: submit the GR's actual quantities to Oracle as an Item Receipt. */
  async receive(grId: string, scope: WarehouseScope & { userId?: number }) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: grId },
      include: { items: true },
    });
    if (!gr || gr.sourceType !== 'CUSTOMER_RETURN' || (scope.role !== 'admin' && !inScope(scope, gr.warehouseId))) {
      throw new NotFoundException(`Goods Receive ${grId} not found`);
    }
    if (gr.status !== 'Open' && gr.status !== 'SyncFailed') {
      throw new BadRequestException(`Cannot receive: GR status is "${gr.status}"`);
    }
    const cr = await this.prisma.customerReturn.findUnique({ where: { id: gr.sourceDocId } });
    if (!cr?.oracleId) {
      throw new BadRequestException('Customer Return has no ERP Doc ID — re-sync it from ERP first');
    }

    const lines = gr.items.filter((it) => it.qtyActual > 0);
    if (!lines.length) throw new BadRequestException('Enter the actual qty of at least one item');
    for (const it of lines) {
      const label = it.materialCode ?? it.itemDisplay ?? it.id;
      if (it.lineNumber == null) throw new BadRequestException(`"${label}" has no ERP line number`);
    }

    // Oracle first — this CREATES a real Item Receipt.
    const payload = {
      transaction_type: 'customer_return',
      transaction_id: cr.oracleId,
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

    // Refresh the return right away so its lines show the received qty.
    // Non-fatal — the GR is already saved.
    try {
      await this.crSync.syncOne(cr.oracleId);
    } catch (e) {
      this.logger.warn(`Customer Return ${cr.oracleId} refresh after receipt failed: ${(e as Error).message}`);
    }
    return { accepted: true, gr_number: grNumber };
  }
}
