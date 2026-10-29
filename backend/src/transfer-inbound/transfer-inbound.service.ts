import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { parseDateRange } from '../common/date-range.util';
import { PutawayService } from '../putaway/putaway.service';
import type { GrFilterField, QueryTransferInboundDto } from './dto/query-transfer-inbound.dto';
import { scopeWhere } from '../common/warehouse-scope';

export interface WarehouseScope {
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

const materialSelect = {
  id: true,
  materialCode: true,
  materialName: true,
  materialLength: true,
  materialWidth: true,
  materialHeight: true,
  materialWeight: true,
  materialType: { select: { materialTypeName: true } },
  materialCategory: { select: { materialCategoryName: true } },
  primaryUom: { select: { uomCode: true } },
} satisfies Prisma.MaterialSelect;
type MaterialInfo = Prisma.MaterialGetPayload<{ select: typeof materialSelect }>;

type GrOrder = Prisma.GoodsReceiveOrderByWithRelationInput;
const GR_SORTABLE: Record<string, (d: SortDir) => GrOrder> = {
  status: (d) => ({ status: d }),
  transaction_id: (d) => ({ sourceDocNumber: d }),
  gr_number: (d) => ({ grNumber: d }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
  updated_at: (d) => ({ updatedAt: d }),
  created_by: (d) => ({ createdBy: { name: d } }),
};

const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

type PutawayOrder = Prisma.PutawayOrderByWithRelationInput;
const PUTAWAY_SORTABLE: Record<string, (d: SortDir) => PutawayOrder> = {
  status: (d) => ({ status: d }),
  putaway_code: (d) => ({ putawayCode: d }),
  gr_number: (d) => ({ goodsReceive: { grNumber: d } }),
  transaction_id: (d) => ({ goodsReceive: { sourceDocNumber: d } }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
  updated_at: (d) => ({ updatedAt: d }),
};

const page = (q: QueryTransferInboundDto) => ({ page: q.page ?? 1, limit: q.limit ?? 10 });
const paged = <T>(q: QueryTransferInboundDto, total: number, rows: T[]) => {
  const { page: p, limit } = page(q);
  return {
    total_page: Math.ceil(total / limit) || 0,
    total_data: total,
    attributes: { page: p, limit, sort_by: q.sort_by ?? null, sort_order: q.sort_order ?? null },
    rows,
  };
};

/**
 * Transfer IN (Inbound from Transfer Order), read the way WMS dev shows it:
 * the Goods Receive and Putaway lists and details, the line-level History,
 * and deleting an Open GR / an untouched putaway. Receive, Generate Putaway
 * and Putaway confirm stay on the shared goods-receive / putaway endpoints.
 */
@Injectable()
export class TransferInboundService {
  private readonly logger = new Logger(TransferInboundService.name);

  constructor(
    private prisma: PrismaService,
    private putaways: PutawayService,
  ) {}

  private scope(scope: WarehouseScope) {
    return scopeWhere(scope, 'warehouseId');
  }

  /** Transfer Orders by id: their ERP doc id and origin warehouse. */
  private async transferOrders(ids: string[]) {
    const tos = ids.length
      ? await this.prisma.transferOrder.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: {
            id: true,
            tranId: true,
            oracleId: true,
            fromLocationName: true,
            warehouse: { select: { name: true } },
          },
        })
      : [];
    return new Map(tos.map((t) => [t.id, t]));
  }

  private async materials(ids: (string | null)[]) {
    const clean = [...new Set(ids.filter((v): v is string => !!v))];
    const mats = clean.length
      ? await this.prisma.material.findMany({ where: { id: { in: clean } }, select: materialSelect })
      : [];
    return new Map(mats.map((m) => [m.id, m]));
  }

  private materialFields(m: MaterialInfo | undefined, code: string | null, display: string | null) {
    return {
      material_code: code ?? m?.materialCode ?? display,
      material_name: m?.materialName ?? display,
      material_type: m?.materialType?.materialTypeName ?? null,
      material_category: m?.materialCategory?.materialCategoryName ?? null,
      uom: m?.primaryUom?.uomCode ?? null,
      material_length: m?.materialLength ?? null,
      material_width: m?.materialWidth ?? null,
      material_height: m?.materialHeight ?? null,
      material_weight: m?.materialWeight ?? null,
    };
  }

  // ---------- Goods Receive ----------

  /**
   * One value of one list filter as a GR condition. Fields living on the
   * Transfer Order (origin, ERP doc id) or on the material (name) are looked
   * up first — GRs only hold their ids.
   */
  private async grFilter(field: GrFilterField, v: string): Promise<Prisma.GoodsReceiveWhereInput> {
    switch (field) {
      case 'material_code':
        return { items: { some: { OR: [{ materialCode: ci(v) }, { itemDisplay: ci(v) }] } } };
      case 'material_name': {
        const mats = await this.prisma.material.findMany({ where: { materialName: ci(v) }, select: { id: true }, take: 1000 });
        return { items: { some: { materialId: { in: mats.map((m) => m.id) } } } };
      }
      case 'origin_warehouse': {
        const tos = await this.prisma.transferOrder.findMany({
          where: { OR: [{ warehouse: { name: ci(v) } }, { fromLocationName: ci(v) }] },
          select: { id: true },
        });
        return { sourceDocId: { in: tos.map((t) => t.id) } };
      }
      case 'erp_doc_id': {
        const tos = await this.prisma.transferOrder.findMany({ where: { oracleId: ci(v) }, select: { id: true } });
        return { sourceDocId: { in: tos.map((t) => t.id) } };
      }
      case 'destination_warehouse':
        return { warehouse: { name: ci(v) } };
      case 'transaction_id':
        return { sourceDocNumber: ci(v) };
      case 'created_by':
        return { createdBy: { name: ci(v) } };
      case 'created_at':
        return { createdAt: parseDateRange(v) };
    }
  }

  private async grWhere(q: QueryTransferInboundDto, scope: WarehouseScope) {
    const where: Prisma.GoodsReceiveWhereInput = { sourceType: 'TO', ...this.scope(scope) };
    if (q.status && q.status !== 'all') where.status = q.status as Prisma.GoodsReceiveWhereInput['status'];
    if (q.search) {
      where.OR = [{ grNumber: ci(q.search) }, { sourceDocNumber: ci(q.search) }];
    }
    // Values of one field are OR-ed; fields are AND-ed.
    const and: Prisma.GoodsReceiveWhereInput[] = [];
    for (const f of q.filters ?? []) {
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (values.length) and.push({ OR: await Promise.all(values.map((v) => this.grFilter(f.field, v))) });
    }
    if (and.length) where.AND = and;
    return where;
  }

  /** A GR line's quantities: putaway / remain only exist once it is received. */
  private grLineQty(it: { qty: number; qtyActual: number; qtyRemaining: number }, received: boolean) {
    return {
      planned_qty: it.qty,
      actual_qty: it.qtyActual,
      putaway_qty: received ? Math.max(0, it.qtyActual - it.qtyRemaining) : 0,
      remain_qty: received ? it.qtyRemaining : 0,
    };
  }

  async listGoodsReceives(q: QueryTransferInboundDto, scope: WarehouseScope) {
    const { page: p, limit } = page(q);
    const where = await this.grWhere(q, scope);
    const orderBy = buildOrderBy(q.sort_by, q.sort_order, GR_SORTABLE, { createdAt: 'desc' } as GrOrder);
    const withItems = q.include_items === 'true';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.goodsReceive.count({ where }),
      this.prisma.goodsReceive.findMany({
        where,
        orderBy,
        skip: (p - 1) * limit,
        take: limit,
        include: {
          warehouse: { select: { name: true, subsidiaryName: true } },
          createdBy: { select: { name: true } },
          _count: { select: { items: true } },
          ...(withItems ? { items: { orderBy: { lineNumber: 'asc' as const } } } : {}),
        },
      }),
    ]);
    const tos = await this.transferOrders(rows.map((r) => r.sourceDocId));
    const lines = rows.flatMap((r) => ('items' in r ? (r.items as Prisma.GoodsReceiveItemGetPayload<object>[]) : []));
    const mats = await this.materials(lines.map((l) => l.materialId));

    // Line quantities summed over every GR matching the filters, not only this page.
    const allLines = await this.prisma.goodsReceiveItem.findMany({
      where: { goodsReceive: where },
      select: { qty: true, qtyActual: true, qtyRemaining: true, goodsReceive: { select: { status: true } } },
    });
    const totals = allLines.reduce(
      (t, l) => {
        const qv = this.grLineQty(l, l.goodsReceive.status !== 'Open' && l.goodsReceive.status !== 'SyncFailed');
        return {
          planned_qty: t.planned_qty + qv.planned_qty,
          actual_qty: t.actual_qty + qv.actual_qty,
          putaway_qty: t.putaway_qty + qv.putaway_qty,
          remain_qty: t.remain_qty + qv.remain_qty,
        };
      },
      { planned_qty: 0, actual_qty: 0, putaway_qty: 0, remain_qty: 0 },
    );

    return {
      ...paged(
        q,
        total,
        rows.map((g) => {
          const to = tos.get(g.sourceDocId);
          const received = g.status !== 'Open' && g.status !== 'SyncFailed';
          return {
            id: g.id,
            status: g.status,
            to_id: g.sourceDocId,
            transaction_id: g.sourceDocNumber ?? to?.tranId ?? null,
            gr_number: g.grNumber,
            erp_doc_id: to?.oracleId ?? null,
            document_type: 'Transfer Order',
            ownership: g.warehouse?.subsidiaryName ?? null,
            warehouse: g.warehouse?.name ?? null,
            origin_warehouse: to?.warehouse?.name ?? to?.fromLocationName ?? null,
            item_count: g._count.items,
            created_by: g.createdBy?.name ?? null,
            created_at: g.createdAt,
            updated_at: g.updatedAt,
            ...('items' in g
              ? {
                  items: (g.items as Prisma.GoodsReceiveItemGetPayload<object>[]).map((it) => {
                    const m = mats.get(it.materialId ?? '');
                    return {
                      id: it.id,
                      line_number: it.lineNumber,
                      material_code: it.materialCode ?? m?.materialCode ?? it.itemDisplay,
                      material_name: m?.materialName ?? it.itemDisplay,
                      material_type: m?.materialType?.materialTypeName ?? null,
                      material_category: m?.materialCategory?.materialCategoryName ?? null,
                      uom: m?.primaryUom?.uomCode ?? null,
                      ...this.grLineQty(it, received),
                    };
                  }),
                }
              : {}),
          };
        }),
      ),
      totals,
    };
  }

  async goodsReceive(id: string, scope: WarehouseScope) {
    const g = await this.prisma.goodsReceive.findFirst({
      where: { id, sourceType: 'TO', ...this.scope(scope) },
      include: {
        warehouse: { select: { id: true, name: true, subsidiaryName: true } },
        createdBy: { select: { name: true } },
        items: { orderBy: { lineNumber: 'asc' } },
        _count: { select: { putaways: true } },
      },
    });
    if (!g) throw new NotFoundException(`Goods Receive ${id} not found`);
    const [tos, mats] = await Promise.all([
      this.transferOrders([g.sourceDocId]),
      this.materials(g.items.map((it) => it.materialId)),
    ]);
    const to = tos.get(g.sourceDocId);
    const received = g.status !== 'Open' && g.status !== 'SyncFailed';
    return {
      id: g.id,
      status: g.status,
      to_id: g.sourceDocId,
      transaction_id: g.sourceDocNumber ?? to?.tranId ?? null,
      gr_number: g.grNumber,
      erp_doc_id: to?.oracleId ?? null,
      document_type: 'Transfer Order',
      ownership: g.warehouse?.subsidiaryName ?? null,
      warehouse: g.warehouse ? { id: g.warehouse.id, name: g.warehouse.name } : null,
      origin_warehouse: to?.warehouse?.name ?? to?.fromLocationName ?? null,
      can_receive: !received,
      can_delete: g.status === 'Open' && g._count.putaways === 0,
      created_by: g.createdBy?.name ?? null,
      created_at: g.createdAt,
      updated_at: g.updatedAt,
      items: g.items.map((it) => ({
        id: it.id,
        line_number: it.lineNumber,
        ...this.materialFields(mats.get(it.materialId ?? ''), it.materialCode, it.itemDisplay),
        planned_qty: it.qty,
        actual_qty: it.qtyActual,
        // What has gone to putaways so far, and what is still to put away.
        putaway_qty: received ? Math.max(0, it.qtyActual - it.qtyRemaining) : 0,
        remain_qty: received ? it.qtyRemaining : 0,
      })),
    };
  }

  /** Delete an Open GR List: its planned qty is free again on the TO lines. */
  async deleteGoodsReceive(id: string, scope: WarehouseScope) {
    const g = await this.prisma.goodsReceive.findFirst({
      where: { id, sourceType: 'TO', ...this.scope(scope) },
      include: { _count: { select: { putaways: true } } },
    });
    if (!g) throw new NotFoundException(`Goods Receive ${id} not found`);
    if (g.status !== 'Open' || g._count.putaways > 0) {
      throw new BadRequestException(`Only an Open Goods Receive can be deleted (current: ${g.status})`);
    }
    // Lines cascade; nothing was received, so no stock or Oracle record to undo.
    await this.prisma.goodsReceive.delete({ where: { id } });
    this.logger.log(`Transfer IN GR ${g.grNumber} deleted`);
    return { deleted: true };
  }

  // ---------- Putaway ----------

  async listPutaways(q: QueryTransferInboundDto, scope: WarehouseScope) {
    const { page: p, limit } = page(q);
    const where: Prisma.PutawayWhereInput = { goodsReceive: { sourceType: 'TO' }, ...this.scope(scope) };
    if (q.search) {
      where.OR = [
        { putawayCode: { contains: q.search, mode: 'insensitive' } },
        { goodsReceive: { grNumber: { contains: q.search, mode: 'insensitive' } } },
        { goodsReceive: { sourceDocNumber: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    const orderBy = buildOrderBy(q.sort_by, q.sort_order, PUTAWAY_SORTABLE, { createdAt: 'desc' } as PutawayOrder);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.putaway.count({ where }),
      this.prisma.putaway.findMany({
        where,
        orderBy,
        skip: (p - 1) * limit,
        take: limit,
        include: {
          goodsReceive: { select: { id: true, grNumber: true, sourceDocNumber: true } },
          warehouse: { select: { name: true, subsidiaryName: true } },
          items: {
            select: {
              actualQty: true,
              qualityIssue: true,
              qtyIssue: true,
              bin: { select: { binLabel: true } },
            },
          },
        },
      }),
    ]);
    return paged(
      q,
      total,
      rows.map((pt) => ({
        id: pt.id,
        status: pt.status,
        transaction_id: pt.goodsReceive?.sourceDocNumber ?? null,
        putaway_code: pt.putawayCode,
        gr_id: pt.goodsReceive?.id ?? null,
        gr_number: pt.goodsReceive?.grNumber ?? null,
        destination_location: [...new Set(pt.items.map((it) => it.bin?.binLabel).filter(Boolean))].join(', ') || null,
        ownership: pt.warehouse?.subsidiaryName ?? null,
        warehouse: pt.warehouse?.name ?? null,
        can_delete:
          pt.status !== 'Closed' && pt.items.every((it) => it.actualQty + it.qualityIssue + it.qtyIssue === 0),
        created_at: pt.createdAt,
        updated_at: pt.updatedAt,
      })),
    );
  }

  async putaway(id: string, scope: WarehouseScope) {
    const pt = await this.prisma.putaway.findFirst({
      where: { id, goodsReceive: { sourceType: 'TO' }, ...this.scope(scope) },
      include: {
        goodsReceive: { select: { id: true, grNumber: true, sourceDocNumber: true } },
        warehouse: { select: { id: true, name: true, subsidiaryName: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            grItem: { select: { materialId: true, lineNumber: true } },
            picker: { select: { id: true, name: true } },
            bin: { select: { id: true, binLabel: true } },
          },
        },
      },
    });
    if (!pt) throw new NotFoundException(`Putaway ${id} not found`);
    const mats = await this.materials(pt.items.map((it) => it.grItem?.materialId ?? null));
    const processed = pt.items.some((it) => it.actualQty + it.qualityIssue + it.qtyIssue > 0);
    return {
      id: pt.id,
      status: pt.status,
      transaction_id: pt.goodsReceive?.sourceDocNumber ?? null,
      putaway_code: pt.putawayCode,
      gr_id: pt.goodsReceive?.id ?? null,
      gr_number: pt.goodsReceive?.grNumber ?? null,
      warehouse: pt.warehouse ? { id: pt.warehouse.id, name: pt.warehouse.name } : null,
      ownership: pt.warehouse?.subsidiaryName ?? null,
      can_putaway: pt.status !== 'Closed',
      can_delete: pt.status !== 'Closed' && !processed,
      created_at: pt.createdAt,
      updated_at: pt.updatedAt,
      items: pt.items.map((it) => ({
        id: it.id,
        line_number: it.grItem?.lineNumber ?? null,
        ...this.materialFields(mats.get(it.grItem?.materialId ?? ''), it.materialCode, it.itemName),
        planned_qty: it.plannedQty,
        actual_qty: it.actualQty,
        quality_issue: it.qualityIssue,
        qty_issue: it.qtyIssue,
        remaining_qty:
          it.actualQty + it.qualityIssue + it.qtyIssue > 0 ? it.remainingQty : it.plannedQty,
        picker: it.picker,
        bin: it.bin ? { id: it.bin.id, label: it.bin.binLabel } : null,
      })),
    };
  }

  deletePutaway(id: string, scope: WarehouseScope) {
    return this.putaways.remove(id, scope);
  }

  // ---------- History ----------

  /** Every material put away from a Transfer Order, one row per putaway line. */
  async history(q: QueryTransferInboundDto, scope: WarehouseScope) {
    const { page: p, limit } = page(q);
    const where: Prisma.PutawayItemWhereInput = {
      putaway: { status: 'Closed', goodsReceive: { sourceType: 'TO' }, ...this.scope(scope) },
    };
    if (q.search) {
      const c = { contains: q.search, mode: 'insensitive' as const };
      where.OR = [
        { materialCode: c },
        { itemName: c },
        { putaway: { putawayCode: c } },
        { putaway: { goodsReceive: { grNumber: c } } },
        { putaway: { goodsReceive: { sourceDocNumber: c } } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.putawayItem.count({ where }),
      this.prisma.putawayItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * limit,
        take: limit,
        include: {
          bin: { select: { binLabel: true } },
          grItem: { select: { materialId: true } },
          putaway: {
            select: {
              putawayCode: true,
              updatedAt: true,
              warehouse: { select: { name: true, subsidiaryName: true } },
              goodsReceive: { select: { grNumber: true, sourceDocNumber: true, sourceDocId: true } },
            },
          },
        },
      }),
    ]);
    const [mats, tos] = await Promise.all([
      this.materials(rows.map((r) => r.grItem?.materialId ?? null)),
      this.transferOrders(rows.map((r) => r.putaway.goodsReceive?.sourceDocId).filter((v): v is string => !!v)),
    ]);
    return paged(
      q,
      total,
      rows.map((r) => {
        const m = this.materialFields(mats.get(r.grItem?.materialId ?? ''), r.materialCode, r.itemName);
        const to = tos.get(r.putaway.goodsReceive?.sourceDocId ?? '');
        return {
          id: r.id,
          transaction_id: r.putaway.goodsReceive?.sourceDocNumber ?? null,
          gr_number: r.putaway.goodsReceive?.grNumber ?? null,
          putaway_code: r.putaway.putawayCode,
          material_code: m.material_code,
          material_name: m.material_name,
          material_type: m.material_type,
          material_category: m.material_category,
          request_qty: r.plannedQty,
          receive_qty: r.actualQty,
          warehouse: r.putaway.warehouse?.name ?? null,
          destination_bin: r.bin?.binLabel ?? null,
          origin_warehouse: to?.warehouse?.name ?? to?.fromLocationName ?? null,
          ownership: r.putaway.warehouse?.subsidiaryName ?? null,
          created_at: r.putaway.updatedAt,
        };
      }),
    );
  }
}
