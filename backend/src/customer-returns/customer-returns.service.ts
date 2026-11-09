import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { paginationMeta } from '../common/pagination';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import { parseDateRange } from '../common/date-range.util';
import { scopeWhere } from '../common/warehouse-scope';
import {
  countRequestGrRows,
  grItemSelect,
  grOf,
  type RequestGrExportRow,
} from '../common/request-gr-export';
import type { CrFilterField, QueryCustomerReturnDto } from './dto/query-customer-return.dto';

export interface WarehouseScope {
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

type CrOrder = Prisma.CustomerReturnOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => CrOrder> = {
  transaction_id: (d) => ({ tranId: d }),
  oracle_id: (d) => ({ oracleId: d }),
  status: (d) => ({ statusName: d }),
  so_return_number: (d) => ({ createdFromDisplay: d }),
  customer_name: (d) => ({ customerName: d }),
  ownership: (d) => ({ subsidiaryDisplay: d }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  last_modified: (d) => ({ lastModified: d }),
  // Oracle's creation time ("2026-10-27T16:43:00+07:00" — sorts as text).
  created_at: (d) => ({ dateCreated: d }),
};
const DEFAULT_ORDER: CrOrder = { dateCreated: 'desc' };

/** Who changed a return last: they only change through the ERP sync. */
const SYNC_ACTOR = 'ERP Sync';

/** Oracle statuses a Customer Return can be received in. */
export const RECEIVABLE_CR_STATUSES = ['pendingReceipt', 'pendingRefundPartReceived', 'partiallyReceived'];

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
} satisfies Prisma.CustomerReturnInclude;

type CrDetail = Prisma.CustomerReturnGetPayload<{ include: typeof detailInclude }>;
type CrLine = CrDetail['lines'][number];

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

/** Oracle's "ASR - PT ADI SIRINGAN RAJAKI" without the code prefix. */
const stripCode = (name: string | null) => name?.replace(/^[^-]+-\s*/, '') ?? null;

/** Planned qty per CR line on GR Lists not received yet (Open / Sync Failed). */
export async function openPlannedByCrLine(prisma: PrismaService, lineIds: string[]) {
  const rows = lineIds.length
    ? await prisma.goodsReceiveItem.findMany({
        where: {
          customerReturnLineId: { in: lineIds },
          goodsReceive: { status: { in: ['Open', 'SyncFailed'] } },
        },
        select: { customerReturnLineId: true, qty: true },
      })
    : [];
  const byLine = new Map<string, number>();
  for (const r of rows) {
    if (!r.customerReturnLineId) continue;
    byLine.set(r.customerReturnLineId, (byLine.get(r.customerReturnLineId) ?? 0) + r.qty);
  }
  return byLine;
}

/**
 * Customer Returns as the Customer Return "Request" screens show them (WMS
 * preprod): the list with its line accordion, and the detail a GR List is
 * generated from.
 */
@Injectable()
export class CustomerReturnsService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.CustomerReturnWhereInput {
    return { subsidiaryId: subsidiarySingleFilter(), ...scopeWhere(scope) };
  }

  /** One value of one list filter as a CR condition (values OR-ed, fields AND-ed). */
  private async filter(field: CrFilterField, v: string): Promise<Prisma.CustomerReturnWhereInput> {
    switch (field) {
      case 'material_code': {
        const mats = await this.prisma.material.findMany({ where: { materialCode: ci(v) }, select: { id: true }, take: 1000 });
        return { lines: { some: { OR: [{ materialId: { in: mats.map((m) => m.id) } }, { itemDisplay: ci(v) }] } } };
      }
      case 'material_name': {
        const mats = await this.prisma.material.findMany({ where: { materialName: ci(v) }, select: { id: true }, take: 1000 });
        return { lines: { some: { OR: [{ materialId: { in: mats.map((m) => m.id) } }, { description: ci(v) }] } } };
      }
      case 'warehouse':
        return { OR: [{ warehouse: { name: ci(v) } }, { locationName: ci(v) }] };
      case 'transaction_id':
        return { tranId: ci(v) };
      case 'erp_doc_id':
        return { oracleId: ci(v) };
      case 'customer':
        return { customerName: ci(v) };
      case 'so_return_number':
        return { createdFromDisplay: ci(v) };
      case 'created_at':
        return { dateCreated: createdRange(v) };
    }
  }

  private async where(query: QueryCustomerReturnDto, scope: WarehouseScope) {
    const where: Prisma.CustomerReturnWhereInput = { ...this.scopeWhere(scope) };
    // Oracle status; empty/"all" → every status.
    if (query.status && query.status !== 'all') where.statusCode = query.status;
    if (query.search) {
      where.OR = [{ tranId: ci(query.search) }, { customerName: ci(query.search) }];
    }
    const and: Prisma.CustomerReturnWhereInput[] = [];
    for (const f of query.filters ?? []) {
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (values.length) and.push({ OR: await Promise.all(values.map((v) => this.filter(f.field, v))) });
    }
    if (and.length) where.AND = and;
    return where;
  }

  async findAll(query: QueryCustomerReturnDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where = await this.where(query, scope);
    const withItems = query.include_items === 'true';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customerReturn.count({ where }),
      this.prisma.customerReturn.findMany({
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
    const lines = rows.flatMap((r) => ('lines' in r ? (r.lines as CrLine[]) : []));
    const [active, customers, mats, planned] = await Promise.all([
      this.activeReturns(ids),
      this.customerNames(rows.map((r) => r.customerId)),
      this.materials(lines.map((l) => l.materialId)),
      openPlannedByCrLine(this.prisma, lines.map((l) => l.id)),
    ]);

    return {
      ...paginationMeta(total, page, limit, query),
      rows: rows.map((r) => ({
        ...this.serializeHeader(r, active.has(r.id), customers),
        line_count: r._count.lines,
        ...('lines' in r ? { items: (r.lines as CrLine[]).map((l) => this.serializeLine(l, mats, planned)) } : {}),
      })),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const cr = await this.prisma.customerReturn.findFirst({
      where: { id, ...this.scopeWhere(scope) },
      include: detailInclude,
    });
    if (!cr) throw new NotFoundException(`Customer return ${id} not found`);
    const [active, customers, mats, planned] = await Promise.all([
      this.activeReturns([cr.id]),
      this.customerNames([cr.customerId]),
      this.materials(cr.lines.map((l) => l.materialId)),
      openPlannedByCrLine(this.prisma, cr.lines.map((l) => l.id)),
    ]);
    return {
      ...this.serializeHeader(cr, active.has(cr.id), customers),
      class_display: cr.classDisplay,
      department_display: cr.departmentDisplay,
      lines: cr.lines.map((l) => this.serializeLine(l, mats, planned)),
    };
  }

  // Most recent sync into WMS — the incremental sync watermark.
  /**
   * The Request export: every Customer Return the list's status and filters match (not only one
   * page), in the list's order, one row per line and Goods Receive line made
   * from it — or one row with the GR columns empty when none was made yet. A
   * Part Number / Material Name filter keeps only the matching lines, as the
   * accordion does. Yielded in batches.
   */
  async *exportRows(query: QueryCustomerReturnDto, scope: WarehouseScope): AsyncGenerator<RequestGrExportRow[]> {
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where = await this.where(query, scope);
    const lineFilters = (query.filters ?? [])
      .filter((f) => f.field === 'material_code' || f.field === 'material_name')
      .map((f) => ({ field: f.field, values: (f.values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean) }))
      .filter((f) => f.values.length);
    const lineMatches = (l: { material_code: string | null; material_name: string | null; item_display: string | null }) =>
      lineFilters.every((f) => {
        const hay = (f.field === 'material_code' ? `${l.material_code ?? ''} ${l.item_display ?? ''}` : (l.material_name ?? '')).toLowerCase();
        return f.values.some((v) => hay.includes(v));
      });
    const BATCH = 100;
    for (let skip = 0; ; skip += BATCH) {
      const docs = await this.prisma.customerReturn.findMany({
        where,
        // The id keeps paging stable when the sort column has ties.
        orderBy: [orderBy, { id: 'asc' }],
        skip,
        take: BATCH,
        include: {
          warehouse: { select: { id: true, name: true } },
          lines: {
            orderBy: { lineNumber: 'asc' },
            include: {
              goodsReceiveItems: {
                select: grItemSelect,
                orderBy: [{ goodsReceive: { createdAt: 'asc' } }, { createdAt: 'asc' }],
              },
            },
          },
        },
      });
      const lines = docs.flatMap((d) => d.lines);
      const [active, customers, mats, planned] = await Promise.all([
        this.activeReturns(docs.map((d) => d.id)),
        this.customerNames(docs.map((d) => d.customerId)),
        this.materials(lines.map((l) => l.materialId)),
        openPlannedByCrLine(this.prisma, lines.map((l) => l.id)),
      ]);
      const rows: RequestGrExportRow[] = [];
      for (const d of docs) {
        const h = this.serializeHeader(d, active.has(d.id), customers);
        const head = {
          doc_id: d.id,
          status: h.status ?? null,
          transaction_id: h.tran_id,
          erp_doc_id: h.oracle_id,
          so_return_number: h.so_return_number,
          ownership: h.ownership ?? null,
          party: h.customer_name,
          warehouse: h.warehouse?.name ?? h.location_name ?? null,
          memo: h.memo,
          created_by: h.created_by,
          created_at: h.created_at,
          last_modified_by: h.last_modified_by,
          last_modified: h.last_modified,
        };
        let no = 0;
        for (const l of d.lines) {
          const s = this.serializeLine(l, mats, planned);
          if (!lineMatches(s)) continue;
          const line = {
            no: ++no,
            line_number: s.line_number,
            material_code: s.material_code,
            material_name: s.material_name,
            material_type: s.material_type,
            material_category: s.material_category,
            uom: s.uom,
            request_qty: s.quantity,
            receive_qty: s.receive_qty,
            remain_qty: s.remain_qty,
          };
          if (!l.goodsReceiveItems.length) rows.push({ ...head, line, gr: null });
          for (const it of l.goodsReceiveItems) rows.push({ ...head, line, gr: grOf(it) });
        }
        if (!no) rows.push({ ...head, line: null, gr: null });
      }
      if (rows.length) yield rows;
      if (docs.length < BATCH) return;
    }
  }

  /**
   * The export confirmation's numbers: documents and rows for the list's
   * status and filters and for every one the user can see, counted by walking
   * exportRows() — exactly what the file would hold.
   */
  async exportSummary(query: QueryCustomerReturnDto, scope: WarehouseScope) {
    const [filtered, all] = await Promise.all([
      countRequestGrRows(this.exportRows(query, scope)),
      countRequestGrRows(this.exportRows({} as QueryCustomerReturnDto, scope)),
    ]);
    return { filtered, all };
  }

  async getLastSyncAt() {
    const latest = await this.prisma.customerReturn.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  /** Returns with a Goods Receive still in progress (not Closed) — "On Progress" in WMS. */
  private async activeReturns(ids: string[]) {
    const grs = ids.length
      ? await this.prisma.goodsReceive.findMany({
          where: { sourceType: 'CUSTOMER_RETURN', sourceDocId: { in: ids }, status: { not: 'Closed' } },
          select: { sourceDocId: true },
        })
      : [];
    return new Set(grs.map((g) => g.sourceDocId));
  }

  /** Customer company names by Oracle customer id ("PT ALAM NUR INSAN"). */
  private async customerNames(customerIds: (string | null)[]) {
    const ids = [...new Set(customerIds.filter((v): v is string => !!v))];
    const customers = ids.length
      ? await this.prisma.customer.findMany({ where: { oracleId: { in: ids } }, select: { oracleId: true, companyName: true } })
      : [];
    return new Map(customers.map((c) => [c.oracleId, c.companyName]));
  }

  private async materials(ids: (string | null)[]) {
    const clean = [...new Set(ids.filter((v): v is string => !!v))];
    const mats = clean.length
      ? await this.prisma.material.findMany({ where: { id: { in: clean } }, select: materialSelect })
      : [];
    return new Map(mats.map((m) => [m.id, m]));
  }

  private serializeHeader(
    cr: Prisma.CustomerReturnGetPayload<{ include: { warehouse: { select: { id: true; name: true } } } }>,
    active: boolean,
    customers: Map<string, string | null>,
  ) {
    return {
      id: cr.id,
      oracle_id: cr.oracleId,
      tran_id: cr.tranId,
      tran_date: cr.tranDate,
      status_code: cr.statusCode,
      status_name: cr.statusName,
      // What the Request screens show: a return being received in WMS is "On Progress".
      status: active ? 'On Progress' : (cr.statusName ?? cr.statusCode),
      so_return_number: cr.createdFromDisplay,
      customer_name: (cr.customerId ? customers.get(cr.customerId) : null) ?? stripCode(cr.customerName),
      // "Motor Sights International : PT Indonesia Equipment Line" → the subsidiary itself.
      ownership: cr.subsidiaryDisplay?.split(' : ').pop() ?? null,
      location_name: cr.locationName,
      warehouse: cr.warehouse,
      memo: cr.memo,
      created_by: cr.createdBy ?? SYNC_ACTOR,
      created_at: oracleDate(cr.dateCreated) ?? cr.createdAt,
      last_modified_by: SYNC_ACTOR,
      last_modified: cr.lastModified,
    };
  }

  private serializeLine(l: CrLine, mats: Map<string, MaterialInfo>, planned: Map<string, number>) {
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
      uom: m?.primaryUom?.uomCode ?? l.units,
      quantity: l.quantity,
      // On GR Lists not received yet.
      gr_qty: grQty,
      // Received in Oracle.
      receive_qty: l.received,
      // Still to put on a GR List (nothing once Oracle closed the line).
      remain_qty: l.closed ? 0 : Math.max(0, l.quantity - l.received - grQty),
      location_name: l.locationName,
    };
  }
}
