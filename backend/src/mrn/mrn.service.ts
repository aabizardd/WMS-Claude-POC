import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type MrnOrder = Prisma.MrnOrderByWithRelationInput;
const MRN_SORTABLE: Record<string, (d: SortDir) => MrnOrder> = {
  shipment_number: (d) => ({ shipmentNumber: d }),
  receiving_location: (d) => ({ receivingLocationName: d }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
};

const mrnInclude = {
  items: true,
  warehouse: { select: { id: true, name: true } },
} satisfies Prisma.MrnInclude;

type MrnWithRelations = Prisma.MrnGetPayload<{ include: typeof mrnInclude }>;

// The Goods Receive that an MRN backs (PIB source). GR no longer has a direct
// mrn relation — it links back via sourceType='PIB' + sourceDocId = mrn.id.
type GrRef = { id: string; grNumber: string; status: string };

@Injectable()
export class MrnService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.MrnWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  // Map mrn.id -> its PIB Goods Receive (if any) for the given MRN ids.
  private async grByMrnId(mrnIds: string[]): Promise<Map<string, GrRef>> {
    if (mrnIds.length === 0) return new Map();
    const grs = await this.prisma.goodsReceive.findMany({
      where: { sourceType: 'PIB', sourceDocId: { in: mrnIds } },
      select: { id: true, grNumber: true, status: true, sourceDocId: true },
    });
    return new Map(
      grs.map((g) => [
        g.sourceDocId,
        { id: g.id, grNumber: g.grNumber, status: g.status },
      ]),
    );
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, MRN_SORTABLE, {
      shipmentNumber: 'desc',
    });

    const where: Prisma.MrnWhereInput = { ...this.scopeWhere(scope) };
    if (query.search) {
      where.OR = [
        { shipmentNumber: { contains: query.search, mode: 'insensitive' } },
        { oracleId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.mrn.count({ where }),
      this.prisma.mrn.findMany({
        where,
        include: mrnInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const grMap = await this.grByMrnId(rows.map((r) => r.id));

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) => this.serialize(r, grMap.get(r.id) ?? null)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const mrn = await this.prisma.mrn.findUnique({
      where: { id },
      include: mrnInclude,
    });
    if (
      !mrn ||
      (scope.role !== 'admin' && mrn.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`MRN ${id} not found`);
    }
    const grMap = await this.grByMrnId([mrn.id]);
    return this.serialize(mrn, grMap.get(mrn.id) ?? null);
  }

  async getLastSyncAt() {
    const latest = await this.prisma.mrn.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(m: MrnWithRelations, goodsReceive: GrRef | null) {
    return {
      id: m.id,
      oracle_id: m.oracleId,
      shipment_number: m.shipmentNumber,
      external_doc_number: m.externalDocNumber,
      external_id: m.externalId,
      status: m.status, // WMS status ("Closed")
      oracle_status: m.oracleStatus,
      expected_shipping_date: m.expectedShippingDate,
      actual_shipping_date: m.actualShippingDate,
      expected_delivery_date: m.expectedDeliveryDate,
      actual_delivery_date: m.actualDeliveryDate,
      memo: m.memo,
      vessel_number: m.vesselNumber,
      bill_of_lading: m.billOfLading,
      port: m.port,
      date_created: m.dateCreated,
      last_modified: m.lastModified,
      receiving_location_name: m.receivingLocationName,
      warehouse: m.warehouse,
      goods_receive: goodsReceive,
      items: m.items.map((it) => ({
        id: it.id,
        item_name: it.itemName,
        po_number: it.poNumber,
        vendor_name: it.vendorName,
        item_description: it.itemDescription,
        qty_expected: it.qtyExpected,
        qty_received: it.qtyReceived,
        qty_remaining: it.qtyRemaining,
        qty_actual: it.qtyActual,
        shipment_item_amount: it.shipmentItemAmount,
        receiving_location_name: it.receivingLocationName,
      })),
      created_at: m.createdAt,
    };
  }
}
