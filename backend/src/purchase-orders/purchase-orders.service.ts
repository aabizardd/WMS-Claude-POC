import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { paginationMeta } from '../common/pagination';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import { parseDateRange } from '../common/date-range.util';
import type { PoFilterField, QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { scopeWhere } from '../common/warehouse-scope';

export interface WarehouseScope {
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

type PoOrder = Prisma.PurchaseOrderOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => PoOrder> = {
  po_number: (d) => ({ poNumber: d }),
  transaction_id: (d) => ({ poNumber: d }),
  oracle_id: (d) => ({ oracleId: d }),
  po_date: (d) => ({ poDate: d }),
  po_status: (d) => ({ poStatus: d }),
  status: (d) => ({ poStatusLabel: d }),
  vendor_name: (d) => ({ vendorName: d }),
  ownership: (d) => ({ subsidiaryDisplay: d }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  last_modified: (d) => ({ lastModified: d }),
  // Oracle's creation time ("2026-10-27T16:43:00+07:00" — sorts as text).
  created_at: (d) => ({ dateCreated: d }),
};
const DEFAULT_ORDER: PoOrder = { dateCreated: 'desc' };

/** Who changed a PO last: they only change through the ERP sync. */
const SYNC_ACTOR = 'ERP Sync';

const materialSelect = {
  id: true,
  materialCode: true,
  materialName: true,
  materialType: { select: { materialTypeName: true } },
  materialCategory: { select: { materialCategoryName: true } },
  primaryUom: { select: { uomCode: true } },
} satisfies Prisma.MaterialSelect;
type MaterialInfo = Prisma.MaterialGetPayload<{ select: typeof materialSelect }>;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  lines: { orderBy: { lineNumber: 'asc' } },
} satisfies Prisma.PurchaseOrderInclude;

type PoDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;
type PoLine = PoDetail['lines'][number];

const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

/**
 * "from..to" as bounds on Oracle's date_created text. Every value carries the
 * same "+07:00" offset, so WIB wall-clock text compares in time order.
 */
function createdRange(value: string): Prisma.StringNullableFilter {
  const { gte, lte } = parseDateRange(value);
  const wib = (d: Date) => {
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const t = new Date(d.getTime() + 7 * 3600_000);
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
  };
  // "+99" sorts after any offset, so the last second of the range is kept.
  return { ...(gte ? { gte: wib(gte) } : {}), ...(lte ? { lte: `${wib(lte)}+99` } : {}) };
}

/** Oracle's "2026-10-27T16:43:00+07:00" as a Date (null when missing). */
function oracleDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Planned qty per PO line on GR Lists not received yet (Open / Sync Failed). */
export async function openPlannedByPoLine(prisma: PrismaService, lineIds: string[]) {
  const rows = lineIds.length
    ? await prisma.goodsReceiveItem.findMany({
        where: {
          purchaseOrderLineId: { in: lineIds },
          goodsReceive: { status: { in: ['Open', 'SyncFailed'] } },
        },
        select: { purchaseOrderLineId: true, qty: true },
      })
    : [];
  const byLine = new Map<string, number>();
  for (const r of rows) {
    if (!r.purchaseOrderLineId) continue;
    byLine.set(r.purchaseOrderLineId, (byLine.get(r.purchaseOrderLineId) ?? 0) + r.qty);
  }
  return byLine;
}

/**
 * Purchase Orders as the Local Vendor "Request" screens show them (WMS dev):
 * the list with its line accordion, and the detail a GR List is generated
 * from.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.PurchaseOrderWhereInput {
    // Subsidiary allow-list (same as SalesOrder/Vendor) + warehouse scoping.
    return {
      subsidiaryId: subsidiarySingleFilter(),
      ...scopeWhere(scope),
    };
  }

  /** One value of one list filter as a PO condition (values OR-ed, fields AND-ed). */
  private async filter(field: PoFilterField, v: string): Promise<Prisma.PurchaseOrderWhereInput> {
    switch (field) {
      case 'material_code': {
        const mats = await this.prisma.material.findMany({ where: { materialCode: ci(v) }, select: { id: true }, take: 1000 });
        return {
          lines: { some: { OR: [{ materialId: { in: mats.map((m) => m.id) } }, { itemDisplay: ci(v) }] } },
        };
      }
      case 'material_name': {
        const mats = await this.prisma.material.findMany({ where: { materialName: ci(v) }, select: { id: true }, take: 1000 });
        return {
          lines: { some: { OR: [{ materialId: { in: mats.map((m) => m.id) } }, { description: ci(v) }] } },
        };
      }
      case 'warehouse':
        return { OR: [{ warehouse: { name: ci(v) } }, { locationName: ci(v) }] };
      case 'transaction_id':
        return { poNumber: ci(v) };
      case 'erp_doc_id':
        return { oracleId: ci(v) };
      case 'created_at':
        return { dateCreated: createdRange(v) };
    }
  }

  private async where(query: QueryPurchaseOrderDto, scope: WarehouseScope) {
    const where: Prisma.PurchaseOrderWhereInput = { ...this.scopeWhere(scope) };
    // Oracle status; empty/"all" → every status (WMS dev's "All Status").
    if (query.status && query.status !== 'all') where.poStatus = query.status;
    if (query.search) {
      where.OR = [{ poNumber: ci(query.search) }, { vendorName: ci(query.search) }];
    }
    const and: Prisma.PurchaseOrderWhereInput[] = [];
    for (const f of query.filters ?? []) {
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (values.length) and.push({ OR: await Promise.all(values.map((v) => this.filter(f.field, v))) });
    }
    if (and.length) where.AND = and;
    return where;
  }

  async findAll(query: QueryPurchaseOrderDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where = await this.where(query, scope);
    const withItems = query.include_items === 'true';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
          ...(withItems ? { lines: { orderBy: { lineNumber: 'asc' as const } } } : {}),
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const lines = rows.flatMap((r) => ('lines' in r ? (r.lines as PoLine[]) : []));
    const [active, vendors, mats, planned] = await Promise.all([
      this.activePos(ids),
      this.vendorNames(rows.map((r) => r.vendorId)),
      this.materials(lines.map((l) => l.materialId)),
      openPlannedByPoLine(this.prisma, lines.map((l) => l.id)),
    ]);

    return {
      ...paginationMeta(total, page, limit, query),
      rows: rows.map((r) => ({
        ...this.serializeHeader(r, active.has(r.id), vendors),
        line_count: r._count.lines,
        ...('lines' in r
          ? { items: (r.lines as PoLine[]).map((l) => this.serializeLine(l, mats, planned)) }
          : {}),
      })),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...this.scopeWhere(scope) },
      include: detailInclude,
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    const [active, vendors, mats, planned] = await Promise.all([
      this.activePos([po.id]),
      this.vendorNames([po.vendorId]),
      this.materials(po.lines.map((l) => l.materialId)),
      openPlannedByPoLine(this.prisma, po.lines.map((l) => l.id)),
    ]);
    return {
      ...this.serializeHeader(po, active.has(po.id), vendors),
      approval_status_display: po.approvalStatusDisplay,
      currency_symbol: po.currencySymbol,
      class_display: po.classDisplay,
      department_display: po.departmentDisplay,
      lines: po.lines.map((l) => this.serializeLine(l, mats, planned)),
    };
  }

  // Distinct PO statuses present (within scope) for the FE status filter.
  async getStatuses(scope: WarehouseScope) {
    const rows = await this.prisma.purchaseOrder.groupBy({
      by: ['poStatus', 'poStatusLabel'],
      where: this.scopeWhere(scope),
      _count: { _all: true },
    });
    return rows
      .filter((r) => r.poStatus)
      .map((r) => ({
        po_status: r.poStatus,
        po_status_label: r.poStatusLabel ?? r.poStatus,
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Most recent last_modified among synced POs — the incremental sync watermark.
  async getLastSyncAt() {
    const latest = await this.prisma.purchaseOrder.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  /** POs with a Goods Receive still in progress (not Closed) — "On Progress" in WMS. */
  private async activePos(ids: string[]) {
    const grs = ids.length
      ? await this.prisma.goodsReceive.findMany({
          where: { sourceType: 'PO', sourceDocId: { in: ids }, status: { not: 'Closed' } },
          select: { sourceDocId: true },
        })
      : [];
    return new Set(grs.map((g) => g.sourceDocId));
  }

  /** Vendor company names by Oracle vendor id ("PT ABE MANDIRI", not "ABE - PT ABE MANDIRI"). */
  private async vendorNames(vendorIds: (number | null)[]) {
    const ids = [...new Set(vendorIds.filter((v): v is number => v != null).map(String))];
    const vendors = ids.length
      ? await this.prisma.vendor.findMany({ where: { oracleId: { in: ids } }, select: { oracleId: true, companyName: true } })
      : [];
    return new Map(vendors.map((v) => [v.oracleId, v.companyName]));
  }

  private async materials(ids: (string | null)[]) {
    const clean = [...new Set(ids.filter((v): v is string => !!v))];
    const mats = clean.length
      ? await this.prisma.material.findMany({ where: { id: { in: clean } }, select: materialSelect })
      : [];
    return new Map(mats.map((m) => [m.id, m]));
  }

  private serializeHeader(
    po: Prisma.PurchaseOrderGetPayload<{ include: { warehouse: { select: { id: true; name: true } } } }>,
    active: boolean,
    vendors: Map<string, string | null>,
  ) {
    return {
      id: po.id,
      oracle_id: po.oracleId,
      po_number: po.poNumber,
      po_date: po.poDate,
      po_status: po.poStatus,
      po_status_label: po.poStatusLabel,
      // What the Request screens show: a PO being received in WMS is "On Progress".
      status: active ? 'On Progress' : (po.poStatusLabel ?? po.poStatus),
      vendor_name:
        (po.vendorId != null ? vendors.get(String(po.vendorId)) : null) ??
        po.vendorName?.replace(/^[^-]+-\s*/, '') ??
        null,
      ownership: po.subsidiaryDisplay,
      subsidiary_display: po.subsidiaryDisplay,
      location_name: po.locationName,
      warehouse: po.warehouse,
      memo: po.memo,
      created_by: po.createdBy ?? SYNC_ACTOR,
      created_by_netsuite: po.createdByNetsuite,
      created_at: oracleDate(po.dateCreated) ?? po.createdAt,
      last_modified_by: SYNC_ACTOR,
      last_modified: po.lastModified,
    };
  }

  private serializeLine(l: PoLine, mats: Map<string, MaterialInfo>, planned: Map<string, number>) {
    const m = l.materialId ? mats.get(l.materialId) : undefined;
    const grQty = planned.get(l.id) ?? 0;
    return {
      id: l.id,
      line_id: l.lineId,
      line_number: l.lineNumber,
      item_oracle_id: l.itemOracleId,
      item_display: l.itemDisplay,
      material_id: l.materialId,
      material_code: m?.materialCode ?? l.itemDisplay,
      material_name: m?.materialName ?? l.description ?? l.itemDisplay,
      material_type: m?.materialType?.materialTypeName ?? null,
      material_category: m?.materialCategory?.materialCategoryName ?? null,
      uom: m?.primaryUom?.uomCode ?? null,
      quantity: l.quantity,
      // On GR Lists not received yet.
      gr_qty: grQty,
      // Received in Oracle.
      receive_qty: l.quantityReceived,
      // Still to put on a GR List.
      remain_qty: Math.max(0, l.quantity - l.quantityReceived - grQty),
      location_name: l.locationName,
    };
  }
}
