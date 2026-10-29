import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { parseDateRange } from '../common/date-range.util';
import { scopeWhere, type WarehouseScope } from '../common/warehouse-scope';
import type { PibGrFilterField, QueryPibInboundDto } from './dto/query-pib-inbound.dto';

const materialSelect = {
  id: true,
  erpDocId: true,
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

/** The MRN (Oracle inbound shipment) behind a PIB GR, as its header shows it. */
const mrnSelect = {
  id: true,
  oracleId: true,
  shipmentNumber: true,
  ajuNumber: true,
  expectedShippingDate: true,
  actualShippingDate: true,
  expectedDeliveryDate: true,
  actualDeliveryDate: true,
  vesselNumber: true,
  billOfLading: true,
  port: true,
  createdBy: true,
} satisfies Prisma.MrnSelect;
type MrnHeader = Prisma.MrnGetPayload<{ select: typeof mrnSelect }>;

type MrnLine = Prisma.MrnItemGetPayload<object>;

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

const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

/** GRs the MRN sync made have no creator; WMS dev shows them as the system's. */
const SYSTEM_ACTOR = 'System Administrator';

const page = (q: QueryPibInboundDto) => ({ page: q.page ?? 1, limit: q.limit ?? 10 });
const paged = <T>(q: QueryPibInboundDto, total: number, rows: T[]) => {
  const { page: p, limit } = page(q);
  return {
    total_page: Math.ceil(total / limit) || 0,
    total_data: total,
    attributes: { page: p, limit, sort_by: q.sort_by ?? null, sort_order: q.sort_order ?? null },
    rows,
  };
};

/** A GR is received once it leaves Open / Sync Failed. */
const isReceived = (status: string) => status !== 'Open' && status !== 'SyncFailed';

/**
 * Inbound from PIB, read the way WMS dev shows it: the Goods Receive and
 * Putaway lists and details and the line-level History. A PIB GR's lines are
 * its MRN's (Oracle inbound shipment) items. Receive, Generate Putaway and
 * Putaway confirm stay on the shared goods-receive / putaway endpoints.
 */
@Injectable()
export class PibInboundService {
  constructor(private prisma: PrismaService) {}

  private scope(scope: WarehouseScope) {
    return scopeWhere(scope, 'warehouseId');
  }

  private async mrns(ids: string[]) {
    const unique = [...new Set(ids)];
    const rows = unique.length
      ? await this.prisma.mrn.findMany({ where: { id: { in: unique } }, select: mrnSelect })
      : [];
    return new Map(rows.map((m) => [m.id, m]));
  }

  /** WMS materials of MRN lines, keyed by Oracle item id (= material.erpDocId). */
  private async materials(itemIds: (number | null)[]) {
    const erpIds = [...new Set(itemIds.filter((v): v is number => v != null))].map(String);
    const mats = erpIds.length
      ? await this.prisma.material.findMany({ where: { erpDocId: { in: erpIds } }, select: materialSelect })
      : [];
    return new Map(mats.map((m) => [m.erpDocId as string, m]));
  }

  private materialOf(mats: Map<string, MaterialInfo>, itemId: number | null) {
    return itemId != null ? mats.get(String(itemId)) : undefined;
  }

  private materialFields(m: MaterialInfo | undefined, line: { itemName: string | null; itemDescription?: string | null }) {
    return {
      material_code: m?.materialCode ?? line.itemName,
      material_name: m?.materialName ?? line.itemDescription ?? line.itemName,
      material_type: m?.materialType?.materialTypeName ?? null,
      material_category: m?.materialCategory?.materialCategoryName ?? null,
      uom: m?.primaryUom?.uomCode ?? null,
      material_length: m?.materialLength ?? null,
      material_width: m?.materialWidth ?? null,
      material_height: m?.materialHeight ?? null,
      material_weight: m?.materialWeight ?? null,
    };
  }

  /** A line's quantities: putaway / remain only exist once the GR is received. */
  private lineQty(it: { qtyExpected: number; qtyActual: number; qtyRemaining: number }, received: boolean) {
    return {
      planned_qty: it.qtyExpected,
      actual_qty: it.qtyActual,
      putaway_qty: received ? Math.max(0, it.qtyActual - it.qtyRemaining) : 0,
      remain_qty: received ? it.qtyRemaining : 0,
    };
  }

  /** The MRN header fields every PIB GR screen shows. */
  private mrnFields(m: MrnHeader | undefined) {
    return {
      erp_doc_id: m?.oracleId ?? null,
      aju_number: m?.ajuNumber ?? null,
      expected_shipping_date: m?.expectedShippingDate ?? null,
      actual_shipping_date: m?.actualShippingDate ?? null,
      expected_delivery_date: m?.expectedDeliveryDate ?? null,
      actual_delivery_date: m?.actualDeliveryDate ?? null,
      vessel_number: m?.vesselNumber ?? null,
      bill_of_lading: m?.billOfLading ?? null,
      port: m?.port ?? null,
    };
  }

  // ---------- Goods Receive ----------

  /** MRN ids whose header or lines match a condition. */
  private async mrnIds(where: Prisma.MrnWhereInput): Promise<string[]> {
    const rows = await this.prisma.mrn.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /**
   * One value of one list filter as a GR condition. Fields that live on the
   * MRN or on its lines are looked up first — a PIB GR only holds the MRN id.
   */
  private async grFilter(field: PibGrFilterField, v: string): Promise<Prisma.GoodsReceiveWhereInput> {
    const byMrn = async (where: Prisma.MrnWhereInput) => ({ sourceDocId: { in: await this.mrnIds(where) } });
    switch (field) {
      case 'material_code': {
        const mats = await this.prisma.material.findMany({
          where: { materialCode: ci(v), erpDocId: { not: null } },
          select: { erpDocId: true },
          take: 1000,
        });
        const itemIds = mats.map((m) => Number(m.erpDocId)).filter((n) => Number.isFinite(n));
        return byMrn({ items: { some: { OR: [{ itemName: ci(v) }, { itemId: { in: itemIds } }] } } });
      }
      case 'material_name': {
        const mats = await this.prisma.material.findMany({
          where: { materialName: ci(v), erpDocId: { not: null } },
          select: { erpDocId: true },
          take: 1000,
        });
        const itemIds = mats.map((m) => Number(m.erpDocId)).filter((n) => Number.isFinite(n));
        return byMrn({ items: { some: { OR: [{ itemDescription: ci(v) }, { itemId: { in: itemIds } }] } } });
      }
      case 'aju_number':
        return byMrn({ ajuNumber: ci(v) });
      case 'vessel_number':
        return byMrn({ vesselNumber: ci(v) });
      case 'bill_of_lading':
        return byMrn({ billOfLading: ci(v) });
      case 'erp_doc_id':
        return byMrn({ oracleId: ci(v) });
      case 'warehouse':
        return { warehouse: { name: ci(v) } };
      case 'transaction_id':
        return { sourceDocNumber: ci(v) };
      case 'created_at':
        return { createdAt: parseDateRange(v) };
    }
  }

  private async grWhere(q: QueryPibInboundDto, scope: WarehouseScope) {
    const where: Prisma.GoodsReceiveWhereInput = { sourceType: 'PIB', ...this.scope(scope) };
    if (q.status && q.status !== 'all') where.status = q.status as Prisma.GoodsReceiveWhereInput['status'];
    if (q.search) where.OR = [{ grNumber: ci(q.search) }, { sourceDocNumber: ci(q.search) }];
    // Values of one field are OR-ed; fields are AND-ed.
    const and: Prisma.GoodsReceiveWhereInput[] = [];
    for (const f of q.filters ?? []) {
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (values.length) and.push({ OR: await Promise.all(values.map((v) => this.grFilter(f.field, v))) });
    }
    if (and.length) where.AND = and;
    return where;
  }

  async listGoodsReceives(q: QueryPibInboundDto, scope: WarehouseScope) {
    const { page: p, limit } = page(q);
    const where = await this.grWhere(q, scope);
    const orderBy = buildOrderBy(q.sort_by, q.sort_order, GR_SORTABLE, { createdAt: 'desc' } as GrOrder);
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
        },
      }),
    ]);
    const mrns = await this.mrns(rows.map((r) => r.sourceDocId));
    const withItems = q.include_items === 'true';
    const lines = withItems
      ? await this.prisma.mrnItem.findMany({
          where: { mrnId: { in: [...mrns.keys()] } },
          orderBy: [{ lineId: 'asc' }, { id: 'asc' }],
        })
      : [];
    const mats = await this.materials(lines.map((l) => l.itemId));
    const linesByMrn = new Map<string, MrnLine[]>();
    for (const l of lines) linesByMrn.set(l.mrnId, [...(linesByMrn.get(l.mrnId) ?? []), l]);
    const counts = withItems
      ? null
      : await this.prisma.mrnItem.groupBy({ by: ['mrnId'], where: { mrnId: { in: [...mrns.keys()] } }, _count: true });

    // Line quantities summed over every GR matching the filters, not only this page.
    const all = await this.prisma.goodsReceive.findMany({ where, select: { sourceDocId: true, status: true } });
    const statusByMrn = new Map(all.map((g) => [g.sourceDocId, g.status]));
    const allLines = await this.prisma.mrnItem.findMany({
      where: { mrnId: { in: [...statusByMrn.keys()] } },
      select: { mrnId: true, qtyExpected: true, qtyActual: true, qtyRemaining: true },
    });
    const totals = allLines.reduce(
      (t, l) => {
        const qv = this.lineQty(l, isReceived(statusByMrn.get(l.mrnId) ?? 'Open'));
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
          const m = mrns.get(g.sourceDocId);
          const received = isReceived(g.status);
          const own = linesByMrn.get(g.sourceDocId) ?? [];
          return {
            id: g.id,
            status: g.status,
            mrn_id: g.sourceDocId,
            transaction_id: g.sourceDocNumber ?? m?.shipmentNumber ?? null,
            gr_number: g.grNumber,
            ...this.mrnFields(m),
            ownership: g.warehouse?.subsidiaryName ?? null,
            warehouse: g.warehouse?.name ?? null,
            item_count: withItems ? own.length : (counts?.find((c) => c.mrnId === g.sourceDocId)?._count ?? 0),
            created_by: g.createdBy?.name ?? SYSTEM_ACTOR,
            created_at: g.createdAt,
            updated_at: g.updatedAt,
            ...(withItems
              ? {
                  items: own.map((it) => ({
                    id: it.id,
                    line_number: it.lineId,
                    ...this.materialFields(this.materialOf(mats, it.itemId), it),
                    ...this.lineQty(it, received),
                  })),
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
      where: { id, sourceType: 'PIB', ...this.scope(scope) },
      include: {
        warehouse: { select: { id: true, name: true, subsidiaryName: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!g) throw new NotFoundException(`Goods Receive ${id} not found`);
    const [mrns, lines] = await Promise.all([
      this.mrns([g.sourceDocId]),
      this.prisma.mrnItem.findMany({ where: { mrnId: g.sourceDocId }, orderBy: [{ lineId: 'asc' }, { id: 'asc' }] }),
    ]);
    const mats = await this.materials(lines.map((l) => l.itemId));
    const m = mrns.get(g.sourceDocId);
    const received = isReceived(g.status);
    return {
      id: g.id,
      status: g.status,
      mrn_id: g.sourceDocId,
      transaction_id: g.sourceDocNumber ?? m?.shipmentNumber ?? null,
      gr_number: g.grNumber,
      ...this.mrnFields(m),
      ownership: g.warehouse?.subsidiaryName ?? null,
      warehouse: g.warehouse ? { id: g.warehouse.id, name: g.warehouse.name } : null,
      can_receive: !received,
      created_by: g.createdBy?.name ?? SYSTEM_ACTOR,
      created_at: g.createdAt,
      updated_at: g.updatedAt,
      items: lines.map((it) => ({
        id: it.id,
        po_number: it.poNumber,
        erp_po_id: it.poId,
        line_number: it.lineId,
        supplier: it.vendorName,
        ...this.materialFields(this.materialOf(mats, it.itemId), it),
        ...this.lineQty(it, received),
      })),
    };
  }

  // ---------- Putaway ----------

  async listPutaways(q: QueryPibInboundDto, scope: WarehouseScope) {
    const { page: p, limit } = page(q);
    const where: Prisma.PutawayWhereInput = { goodsReceive: { sourceType: 'PIB' }, ...this.scope(scope) };
    if (q.search) {
      where.OR = [
        { putawayCode: ci(q.search) },
        { goodsReceive: { grNumber: ci(q.search) } },
        { goodsReceive: { sourceDocNumber: ci(q.search) } },
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
          goodsReceive: { select: { id: true, grNumber: true, sourceDocNumber: true, sourceDocId: true } },
          warehouse: { select: { name: true, subsidiaryName: true } },
          items: {
            select: { actualQty: true, qualityIssue: true, qtyIssue: true, bin: { select: { binLabel: true } } },
          },
        },
      }),
    ]);
    const mrns = await this.mrns(rows.map((r) => r.goodsReceive?.sourceDocId).filter((v): v is string => !!v));
    return paged(
      q,
      total,
      rows.map((pt) => ({
        id: pt.id,
        status: pt.status,
        transaction_id: pt.goodsReceive?.sourceDocNumber ?? null,
        aju_number: mrns.get(pt.goodsReceive?.sourceDocId ?? '')?.ajuNumber ?? null,
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
      where: { id, goodsReceive: { sourceType: 'PIB' }, ...this.scope(scope) },
      include: {
        goodsReceive: { select: { id: true, grNumber: true, sourceDocNumber: true, sourceDocId: true } },
        warehouse: { select: { id: true, name: true, subsidiaryName: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            mrnItem: true,
            picker: { select: { id: true, name: true } },
            bin: { select: { id: true, binLabel: true } },
          },
        },
      },
    });
    if (!pt) throw new NotFoundException(`Putaway ${id} not found`);
    const [mats, mrns] = await Promise.all([
      this.materials(pt.items.map((it) => it.mrnItem?.itemId ?? null)),
      this.mrns(pt.goodsReceive ? [pt.goodsReceive.sourceDocId] : []),
    ]);
    const processed = pt.items.some((it) => it.actualQty + it.qualityIssue + it.qtyIssue > 0);
    return {
      id: pt.id,
      status: pt.status,
      transaction_id: pt.goodsReceive?.sourceDocNumber ?? null,
      aju_number: mrns.get(pt.goodsReceive?.sourceDocId ?? '')?.ajuNumber ?? null,
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
        po_number: it.mrnItem?.poNumber ?? it.poNumber,
        erp_po_id: it.mrnItem?.poId ?? null,
        line_number: it.mrnItem?.lineId ?? null,
        ...this.materialFields(this.materialOf(mats, it.mrnItem?.itemId ?? null), {
          itemName: it.materialCode ?? it.mrnItem?.itemName ?? it.itemName,
          itemDescription: it.mrnItem?.itemDescription ?? it.itemName,
        }),
        planned_qty: it.plannedQty,
        actual_qty: it.actualQty,
        quality_issue: it.qualityIssue,
        qty_issue: it.qtyIssue,
        remaining_qty: it.actualQty + it.qualityIssue + it.qtyIssue > 0 ? it.remainingQty : it.plannedQty,
        picker: it.picker,
        bin: it.bin ? { id: it.bin.id, label: it.bin.binLabel } : null,
      })),
    };
  }

  // ---------- History ----------

  /** Every material put away from a PIB, one row per putaway line. */
  async history(q: QueryPibInboundDto, scope: WarehouseScope) {
    const { page: p, limit } = page(q);
    const where: Prisma.PutawayItemWhereInput = {
      putaway: { status: 'Closed', goodsReceive: { sourceType: 'PIB' }, ...this.scope(scope) },
    };
    if (q.search) {
      where.OR = [
        { materialCode: ci(q.search) },
        { itemName: ci(q.search) },
        { poNumber: ci(q.search) },
        { putaway: { putawayCode: ci(q.search) } },
        { putaway: { goodsReceive: { grNumber: ci(q.search) } } },
        { putaway: { goodsReceive: { sourceDocNumber: ci(q.search) } } },
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
          mrnItem: true,
          putaway: {
            select: {
              putawayCode: true,
              updatedAt: true,
              warehouse: { select: { name: true, subsidiaryName: true } },
              goodsReceive: {
                select: { grNumber: true, sourceDocNumber: true, sourceDocId: true, createdBy: { select: { name: true } } },
              },
            },
          },
        },
      }),
    ]);
    const [mats, mrns] = await Promise.all([
      this.materials(rows.map((r) => r.mrnItem?.itemId ?? null)),
      this.mrns(rows.map((r) => r.putaway.goodsReceive?.sourceDocId).filter((v): v is string => !!v)),
    ]);
    return paged(
      q,
      total,
      rows.map((r) => {
        const m = this.materialFields(this.materialOf(mats, r.mrnItem?.itemId ?? null), {
          itemName: r.materialCode ?? r.mrnItem?.itemName ?? r.itemName,
          itemDescription: r.mrnItem?.itemDescription ?? r.itemName,
        });
        return {
          id: r.id,
          transaction_id: r.putaway.goodsReceive?.sourceDocNumber ?? null,
          aju_number: mrns.get(r.putaway.goodsReceive?.sourceDocId ?? '')?.ajuNumber ?? null,
          po_number: r.mrnItem?.poNumber ?? r.poNumber,
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
          supplier: r.mrnItem?.vendorName ?? r.vendorName,
          ownership: r.putaway.warehouse?.subsidiaryName ?? null,
          created_by: r.putaway.goodsReceive?.createdBy?.name ?? SYSTEM_ACTOR,
          created_at: r.putaway.updatedAt,
        };
      }),
    );
  }
}
