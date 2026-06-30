import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const mrnInclude = {
  items: true,
  warehouse: { select: { id: true, name: true } },
  goodsReceive: { select: { id: true, grNumber: true, status: true } },
} satisfies Prisma.MrnInclude;

type MrnWithRelations = Prisma.MrnGetPayload<{ include: typeof mrnInclude }>;

@Injectable()
export class MrnService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.MrnWhereInput {
    if (scope.role === 'admin') return {};
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  async findAll(
    query: { page?: number; limit?: number; search?: string },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

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
        orderBy: { shipmentNumber: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: { page, limit, order_by: 'shipment_number desc' },
      rows: rows.map((r) => this.serialize(r)),
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
    return this.serialize(mrn);
  }

  async getLastSyncAt() {
    const latest = await this.prisma.mrn.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(m: MrnWithRelations) {
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
      goods_receive: m.goodsReceive,
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
