import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateActualsDto } from './dto/update-actuals.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type GrOrder = Prisma.GoodsReceiveOrderByWithRelationInput;
const GR_SORTABLE: Record<string, (d: SortDir) => GrOrder> = {
  gr_number: (d) => ({ grNumber: d }),
  shipment_number: (d) => ({ mrn: { shipmentNumber: d } }),
  receiving_location: (d) => ({ warehouse: { name: d } }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
};

const grInclude = {
  warehouse: { select: { id: true, name: true } },
  mrn: {
    include: {
      items: { include: { bin: { select: { id: true, binLabel: true } } } },
    },
  },
} satisfies Prisma.GoodsReceiveInclude;

type GrWithRelations = Prisma.GoodsReceiveGetPayload<{
  include: typeof grInclude;
}>;

@Injectable()
export class GoodsReceiveService {
  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.GoodsReceiveWhereInput {
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
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, GR_SORTABLE, {
      mrn: { shipmentNumber: 'desc' },
    });

    const where: Prisma.GoodsReceiveWhereInput = { ...this.scopeWhere(scope) };
    if (query.search) {
      where.OR = [
        { grNumber: { contains: query.search, mode: 'insensitive' } },
        {
          mrn: {
            shipmentNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.goodsReceive.count({ where }),
      this.prisma.goodsReceive.findMany({
        where,
        include: grInclude,
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
      },
      rows: rows.map((r) => this.serializeList(r)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const gr = await this.getScoped(id, scope);
    return this.serializeDetail(gr);
  }

  // Fill the actual received quantity for the GR's items.
  async updateActuals(id: string, dto: UpdateActualsDto, scope: WarehouseScope) {
    const gr = await this.getScoped(id, scope);

    const itemById = new Map(gr.mrn.items.map((it) => [it.id, it]));
    for (const row of dto.items) {
      const item = itemById.get(row.id);
      if (!item) {
        throw new BadRequestException(`Item ${row.id} is not part of this GR`);
      }
      // Actual cannot exceed expected. (Shortage — actual < expected — is allowed
      // and recorded as a discrepancy when the GR is received.)
      if (row.qtyActual > item.qtyExpected) {
        throw new BadRequestException(
          `Actual (${row.qtyActual}) cannot exceed expected (${item.qtyExpected}) for "${item.itemName ?? row.id}"`,
        );
      }
    }

    await this.prisma.$transaction(
      dto.items.map((row) =>
        this.prisma.mrnItem.update({
          where: { id: row.id },
          data: {
            qtyActual: row.qtyActual,
            // qty_remaining follows the actual received quantity.
            qtyRemaining: row.qtyActual,
            // binId: undefined = unchanged, null = clear, string = set
            ...(row.binId !== undefined
              ? {
                  bin: row.binId
                    ? { connect: { id: row.binId } }
                    : { disconnect: true },
                }
              : {}),
          },
        }),
      ),
    );

    const updated = await this.getScoped(id, scope);
    return this.serializeDetail(updated);
  }

  private async getScoped(id: string, scope: WarehouseScope) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id },
      include: grInclude,
    });
    if (
      !gr ||
      (scope.role !== 'admin' && gr.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Goods Receive ${id} not found`);
    }
    return gr;
  }

  private serializeList(gr: GrWithRelations) {
    return {
      id: gr.id,
      gr_number: gr.grNumber,
      status: gr.status,
      shipment_number: gr.mrn.shipmentNumber,
      receiving_location_name: gr.mrn.receivingLocationName,
      warehouse: gr.warehouse,
      item_count: gr.mrn.items.length,
      created_at: gr.createdAt,
    };
  }

  // Goods Receive hides shipment amount and all *_id fields (names only).
  private serializeDetail(gr: GrWithRelations) {
    const m = gr.mrn;
    return {
      id: gr.id,
      gr_number: gr.grNumber,
      status: gr.status,
      warehouse: gr.warehouse,
      // MRN information shown on the Goods Receive screen.
      mrn: {
        id: m.id,
        oracle_id: m.oracleId,
        shipment_number: m.shipmentNumber,
        oracle_status: m.oracleStatus,
        status: m.status,
        expected_delivery_date: m.expectedDeliveryDate,
        actual_delivery_date: m.actualDeliveryDate,
        vessel_number: m.vesselNumber,
        bill_of_lading: m.billOfLading,
        port: m.port,
        memo: m.memo,
        date_created: m.dateCreated,
        receiving_location_name: m.receivingLocationName,
      },
      shipment_number: m.shipmentNumber,
      receiving_location_name: m.receivingLocationName,
      items: m.items.map((it) => ({
        id: it.id,
        item_name: it.itemName,
        po_number: it.poNumber,
        vendor_name: it.vendorName,
        item_description: it.itemDescription,
        qty_expected: it.qtyExpected,
        qty_actual: it.qtyActual,
        qty_remaining: it.qtyRemaining,
        bin_id: it.binId,
        bin_label: it.bin?.binLabel ?? null,
        receiving_location_name: it.receivingLocationName,
      })),
      created_at: gr.createdAt,
    };
  }
}
