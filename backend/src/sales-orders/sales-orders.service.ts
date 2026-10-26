import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import { usableBinStockWhere } from '../common/frozen-bins';
import {
  SALES_ORDER_DATE_FIELDS,
  SALES_ORDER_ITEM_FIELDS,
  type SalesOrderFilterDto,
} from './dto/query-sales-order.dto';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

/** Who writes sales orders in WMS: they only ever arrive through the sync. */
const SYNC_ACTOR = 'ERP Sync';

type SalesOrderOrder = Prisma.SalesOrderOrderByWithRelationInput;
const SALES_ORDER_SORTABLE: Record<string, (d: SortDir) => SalesOrderOrder> = {
  tran_id: (d) => ({ tranId: d }),
  oracle_id: (d) => ({ oracleId: d }),
  ownership: (d) => ({ subsidiaryName: d }),
  customer_name: (d) => ({ customerName: d }),
  created_by: (d) => ({ createdBy: d }),
  location: (d) => ({ warehouse: { name: d } }),
  status_name: (d) => ({ statusName: d }),
  delivery_status: (d) => ({ deliveryStatus: d }),
  total_amount: (d) => ({ totalAmount: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};

// How each header column maps to a Prisma predicate (case-insensitive contains).
const HEADER_FILTERS: Record<
  string,
  (v: string) => Prisma.SalesOrderWhereInput
> = {
  tran_id: (v) => ({ tranId: { contains: v, mode: 'insensitive' } }),
  oracle_id: (v) => ({ oracleId: { contains: v, mode: 'insensitive' } }),
  customer_name: (v) => ({ customerName: { contains: v, mode: 'insensitive' } }),
  // Exact: the value comes from the warehouse dropdown, which sends ids.
  warehouse_id: (v) => ({ warehouseId: v }),
  // Free text on the warehouse name (the tracking page's filter field).
  warehouse_name: (v) => ({ warehouse: { name: { contains: v, mode: 'insensitive' } } }),
  status_name: (v) => ({ statusName: { contains: v, mode: 'insensitive' } }),
  memo: (v) => ({ memo: { contains: v, mode: 'insensitive' } }),
};

// Item columns, matched against the order's lines.
const ITEM_FILTERS: Record<
  string,
  (v: string) => Prisma.SalesOrderItemWhereInput
> = {
  item_name: (v) => ({ itemName: { contains: v, mode: 'insensitive' } }),
  material_code: (v) => ({
    OR: [
      { material: { materialCode: { contains: v, mode: 'insensitive' } } },
      // Orders whose line was never linked to a material still carry the code
      // inside the Oracle item name, so they are not silently missed.
      { itemName: { contains: v, mode: 'insensitive' } },
    ],
  }),
  material_name: (v) => ({
    material: { materialName: { contains: v, mode: 'insensitive' } },
  }),
  item_description: (v) => ({ description: { contains: v, mode: 'insensitive' } }),
};

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.SalesOrderInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  items: {
    include: {
      material: {
        select: {
          materialCode: true,
          materialName: true,
          primaryUom: { select: { uomCode: true } },
        },
      },
      // What actually went out: lines of deliveries that were shipped.
      deliveryItems: {
        where: { delivery: { status: 'Closed' } },
        select: { qty: true },
      },
    },
    orderBy: { lineNumber: 'asc' as const },
  },
} satisfies Prisma.SalesOrderInclude;

type SoList = Prisma.SalesOrderGetPayload<{ include: typeof listInclude }>;
type SoDetail = Prisma.SalesOrderGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class SalesOrdersService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.SalesOrderWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      filters?: SalesOrderFilterDto[];
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      SALES_ORDER_SORTABLE,
      { lastModified: 'desc' },
    );

    const where: Prisma.SalesOrderWhereInput = {
      ...this.scopeWhere(scope),
      // Only sales orders within the allowed subsidiary are visible.
      subsidiaryId: subsidiarySingleFilter(),
    };
    // Status filtering is done here in WMS (on stored data), not sent to Oracle.
    if (query.status) {
      where.statusName = query.status;
    }
    if (query.search) {
      where.OR = [
        { tranId: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { oracleId: { contains: query.search, mode: 'insensitive' } },
        { locationName: { contains: query.search, mode: 'insensitive' } },
        { warehouse: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    // Several values on one column are OR-ed ("any of these"); separate
    // columns stay AND-ed, so adding a filter always narrows.
    const filters = (query.filters ?? [])
      .map((f) => ({
        field: f.field,
        values: (f.values ?? []).map((v) => v.trim()).filter(Boolean),
      }))
      .filter((f) => f.values.length);

    if (filters.length) {
      const and: Prisma.SalesOrderWhereInput[] = [];
      const itemClauses: Prisma.SalesOrderItemWhereInput[] = [];

      for (const f of filters) {
        if (SALES_ORDER_ITEM_FIELDS.includes(f.field)) {
          itemClauses.push({
            OR: f.values.map((v) => ITEM_FILTERS[f.field](v)),
          });
        } else if (SALES_ORDER_DATE_FIELDS.includes(f.field)) {
          and.push({ OR: f.values.map((v) => this.createdAtRange(v)) });
        } else if (f.field === 'delivery_status') {
          // An enum: only exact members can match, so unknown values are a
          // deliberate no-match rather than an error.
          and.push({ deliveryStatus: this.parseDeliveryStatus(f.values) });
        } else {
          and.push({ OR: f.values.map((v) => HEADER_FILTERS[f.field](v)) });
        }
      }

      // Item filters are AND-ed inside ONE line: asking for a material code and
      // an item name means a single line matches both, not two different lines.
      if (itemClauses.length) {
        and.push({ items: { some: { AND: itemClauses } } });
      }
      where.AND = and;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where,
        include: listInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
        filters,
      },
      rows: rows.map((r) => this.serializeList(r)),
    };
  }

  /**
   * Turn "YYYY-MM-DD[THH:mm]..YYYY-MM-DD[THH:mm]" into a createdAt window.
   * Either side may be empty for an open-ended range, and the time is optional
   * on each side independently.
   *
   * Values are read in the server's local time. Whichever unit the user stopped
   * at is included in full: a start without a time begins at 00:00, an end
   * without a time runs to 23:59:59.999, and an end WITH a time runs to the end
   * of that minute — so 09:30 covers everything created during 09:30.
   */
  private createdAtRange(value: string): Prisma.SalesOrderWhereInput {
    const [rawFrom = '', rawTo = ''] = value.split('..');

    const parse = (
      raw: string,
      edge: 'start' | 'end',
    ): { at: Date; hasTime: boolean } | null => {
      const t = raw.trim();
      if (!t) return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(t);
      if (!m) {
        throw new BadRequestException(
          `Date filter must be "YYYY-MM-DD[THH:mm]..YYYY-MM-DD[THH:mm]" (got "${value}")`,
        );
      }
      const hasTime = m[4] !== undefined;
      const hh = hasTime ? Number(m[4]) : edge === 'start' ? 0 : 23;
      const mm = hasTime ? Number(m[5]) : edge === 'start' ? 0 : 59;
      if (hh > 23 || mm > 59) {
        throw new BadRequestException(`"${t}" is not a valid time`);
      }
      // The end edge covers its last unit completely.
      const ss = edge === 'start' ? 0 : 59;
      const ms = edge === 'start' ? 0 : 999;
      const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        hh,
        mm,
        ss,
        ms,
      );
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`"${t}" is not a valid date`);
      }
      return { at: d, hasTime };
    };

    const from = parse(rawFrom, 'start');
    const to = parse(rawTo, 'end');
    if (!from && !to) {
      throw new BadRequestException(
        'A date filter needs at least one side of the range',
      );
    }
    if (from && to && from.at > to.at) {
      throw new BadRequestException(
        'The start of the date range is after its end',
      );
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from.at;
    if (to) createdAt.lte = to.at;
    return { createdAt };
  }

  /** Delivery status is an enum; unrecognised values match nothing. */
  private parseDeliveryStatus(values: string[]): Prisma.EnumDeliveryStatusFilter {
    const members = Object.values(DeliveryStatus);
    const matched = values
      .map((v) => members.find((m) => m.toLowerCase() === v.toLowerCase()))
      .filter((m): m is DeliveryStatus => !!m);
    return { in: matched };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !so ||
      (scope.role !== 'admin' && so.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Sales Order ${id} not found`);
    }

    // Stock that can still be picked for each material in the order's
    // warehouse (frozen KIT stock excluded, as on the picking screen).
    const materialIds = so.items.map((it) => it.materialId).filter((m): m is string => !!m);
    const available = new Map<string, number>();
    if (so.warehouseId && materialIds.length) {
      const invs = await this.prisma.inventoryManagement.findMany({
        where: { warehouseId: so.warehouseId, materialId: { in: materialIds } },
        select: {
          materialId: true,
          binStocks: { where: usableBinStockWhere(), select: { availQty: true } },
        },
      });
      for (const inv of invs) {
        if (!inv.materialId) continue;
        available.set(
          inv.materialId,
          (available.get(inv.materialId) ?? 0) +
            inv.binStocks.reduce((sum, b) => sum + b.availQty, 0),
        );
      }
    }
    return this.serializeDetail(so, available);
  }

  // Distinct statuses present in stored data — populates the FE status filter.
  async getStatuses(scope: WarehouseScope) {
    const rows = await this.prisma.salesOrder.findMany({
      where: {
        ...this.scopeWhere(scope),
        statusName: { not: null },
        subsidiaryId: subsidiarySingleFilter(),
      },
      distinct: ['statusName'],
      select: { statusName: true },
      orderBy: { statusName: 'asc' },
    });
    return { statuses: rows.map((r) => r.statusName).filter((s): s is string => !!s) };
  }

  async getLastSyncAt() {
    const latest = await this.prisma.salesOrder.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serializeList(s: SoList) {
    return {
      id: s.id,
      oracle_id: s.oracleId,
      tran_id: s.tranId,
      tran_date: s.tranDate,
      status_name: s.statusName,
      delivery_status: s.deliveryStatus,
      customer_name: s.customerName,
      location_name: s.locationName,
      warehouse: s.warehouse,
      total_amount: s.totalAmount,
      item_count: s._count.items,
      // The selling entity the order belongs to, shown as "Ownership".
      ownership: s.subsidiaryName,
      created_by: s.createdBy,
      // Orders only change through the Oracle sync, so that is who last
      // modified them.
      last_modified_by: SYNC_ACTOR,
      last_modified: s.lastModified,
      created_at: s.createdAt,
    };
  }

  private serializeDetail(s: SoDetail, available = new Map<string, number>()) {
    return {
      id: s.id,
      oracle_id: s.oracleId,
      tran_id: s.tranId,
      tran_date: s.tranDate,
      status_code: s.statusCode,
      status_name: s.statusName,
      delivery_status: s.deliveryStatus,
      customer_id: s.customerId,
      customer_name: s.customerName,
      memo: s.memo,
      location_name: s.locationName,
      warehouse: s.warehouse,
      subsidiary_name: s.subsidiaryName,
      ownership: s.subsidiaryName,
      currency_name: s.currencyName,
      total_amount: s.totalAmount,
      last_modified: s.lastModified,
      date_created: s.dateCreated,
      created_at: s.createdAt,
      items: s.items.map((it) => ({
        id: it.id,
        line_number: it.lineNumber,
        item_oracle_id: it.itemOracleId,
        item_name: it.itemName,
        material_code: it.material?.materialCode ?? null,
        material_name: it.material?.materialName ?? null,
        uom: it.material?.primaryUom?.uomCode ?? null,
        available_qty: it.materialId ? (available.get(it.materialId) ?? 0) : 0,
        quantity: it.quantity,
        // Already sent to picking: what is no longer remaining.
        given_qty: Math.max(0, it.quantity - it.remainingQty),
        remaining_qty: it.remainingQty,
        actual_delivery: it.deliveryItems.reduce((sum, d) => sum + d.qty, 0),
        rate: it.rate,
        amount: it.amount,
        shipped: it.shipped,
        description: it.description,
        location_id: it.locationId,
      })),
    };
  }
}
