import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GenerateDeliveryDto } from './dto/generate-delivery.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface ItemFulfillmentResponse {
  success: boolean;
  data?: { status?: string; fulfillment_id?: number; local_id?: number };
  message?: string;
}

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const packingSelect = {
  id: true,
  packingCode: true,
  picking: {
    select: {
      id: true,
      pickingCode: true,
      status: true,
      salesOrder: {
        select: { id: true, oracleId: true, tranId: true, customerName: true },
      },
    },
  },
} satisfies Prisma.PackingSelect;

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  packing: { select: packingSelect },
  _count: { select: { items: true } },
} satisfies Prisma.DeliveryInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  packing: { select: packingSelect },
  items: {
    include: {
      material: {
        select: {
          materialCode: true,
          materialName: true,
          primaryUom: { select: { uomCode: true } },
        },
      },
      salesOrderItem: { select: { lineNumber: true } },
      bin: { select: { id: true, binLabel: true } },
      picker: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.DeliveryInclude;

type DeliveryList = Prisma.DeliveryGetPayload<{ include: typeof listInclude }>;
type DeliveryDetail = Prisma.DeliveryGetPayload<{ include: typeof detailInclude }>;

type DeliveryOrder = Prisma.DeliveryOrderByWithRelationInput;
const DELIVERY_SORTABLE: Record<string, (d: SortDir) => DeliveryOrder> = {
  delivery_code: (d) => ({ deliveryCode: d }),
  sdo_id: (d) => ({ sdoId: d }),
  packing_id: (d) => ({ packing: { packingCode: d } }),
  so_number: (d) => ({ packing: { picking: { salesOrder: { tranId: d } } } }),
  customer: (d) => ({
    packing: { picking: { salesOrder: { customerName: d } } },
  }),
  location: (d) => ({ warehouse: { name: d } }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
};

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
    private config: ConfigService,
  ) {}

  // ---------- Oracle Item Fulfillment bridge ----------

  private baseUrl() {
    const url = this.config.get<string>('ERP_BASE_URL');
    if (!url) throw new Error('ERP_BASE_URL is not configured');
    return url.replace(/\/$/, '');
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl()}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.config.get<string>('ERP_CLIENT_ID'),
        client_secret: this.config.get<string>('ERP_CLIENT_SECRET'),
      }),
    });
    if (!res.ok) {
      throw new Error(`ERP auth failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as ErpAuthResponse;
    const token = json?.data?.access_token;
    if (!token) throw new Error('ERP auth: access_token missing in response');
    return token;
  }

  // Create an Item Fulfillment in Oracle. Throws (503) on any failure so the
  // caller can surface a retry; nothing is persisted unless this succeeds.
  private async submitItemFulfillment(
    salesOrderId: string,
    items: { line: number; quantity: number }[],
  ): Promise<ItemFulfillmentResponse['data'] & { message?: string }> {
    let res: Response;
    try {
      const token = await this.getAccessToken();
      res = await fetch(`${this.baseUrl()}/items/item-fulfillment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          // Outbound from a Sales Order. transaction_type is one of
          // sales_order | transfer_order | vendor_return; transaction_id was
          // formerly sent as sales_order_id.
          transaction_type: 'sales_order',
          transaction_id: salesOrderId,
          ship_status: 'shipped',
          items,
        }),
      });
    } catch (e) {
      throw new ServiceUnavailableException(
        `Failed to reach Oracle Item Fulfillment: ${(e as Error).message}`,
      );
    }

    const json = (await res.json().catch(() => null)) as ItemFulfillmentResponse | null;
    if (!res.ok || !json?.success) {
      throw new ServiceUnavailableException(
        json?.message ?? `Oracle Item Fulfillment failed (HTTP ${res.status})`,
      );
    }
    return { ...json.data, message: json.message };
  }

  private scopeWhere(scope: WarehouseScope): Prisma.DeliveryWhereInput {
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
      history?: string | boolean;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, DELIVERY_SORTABLE, {
      createdAt: 'desc',
    });

    // History tab = Closed (shipped) deliveries; Delivery List = active (Open).
    const isHistory = query.history === true || query.history === 'true';
    const where: Prisma.DeliveryWhereInput = {
      ...this.scopeWhere(scope),
      status: isHistory ? 'Closed' : { not: 'Closed' },
    };
    if (query.search) {
      where.OR = [
        { deliveryCode: { contains: query.search, mode: 'insensitive' } },
        { sdoId: { contains: query.search, mode: 'insensitive' } },
        { packing: { packingCode: { contains: query.search, mode: 'insensitive' } } },
        {
          packing: {
            picking: {
              salesOrder: { tranId: { contains: query.search, mode: 'insensitive' } },
            },
          },
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
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
      },
      rows: rows.map((r) => this.serializeList(r)),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!d || (scope.role !== 'admin' && d.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    return this.serializeDetail(d);
  }

  // ---------- generate ----------

  async generate(dto: GenerateDeliveryDto, scope: WarehouseScope) {
    if (!dto.packingIds?.length) {
      throw new BadRequestException('No packing documents selected');
    }

    const packings = await this.prisma.packing.findMany({
      where: { id: { in: dto.packingIds } },
      include: { items: true, delivery: { select: { id: true } } },
    });
    const byId = new Map(packings.map((p) => [p.id, p]));

    for (const id of dto.packingIds) {
      const p = byId.get(id);
      if (!p) throw new BadRequestException(`Packing ${id} not found`);
      if (scope.role !== 'admin' && p.warehouseId !== scope.warehouseId) {
        throw new NotFoundException(`Packing ${id} not found`);
      }
      if (p.status !== 'Closed') {
        throw new BadRequestException(
          `Only Closed packings can be delivered (${p.packingCode} is ${p.status})`,
        );
      }
      if (p.delivery) {
        throw new BadRequestException(
          `Packing ${p.packingCode} already has a delivery document`,
        );
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseCount = await this.prisma.delivery.count({
      where: { deliveryCode: { startsWith: `DEL-${today}` } },
    });

    const createdCodes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      let seq = baseCount;
      for (const id of dto.packingIds) {
        const p = byId.get(id)!;
        seq += 1;
        const deliveryCode = `DEL-${today}-${String(seq).padStart(3, '0')}`;
        // Carry the actually-packed qty (per item) into the delivery. Items with
        // nothing packed (all issue) are skipped.
        const items = p.items
          .filter((it) => it.actualQty > 0)
          .map((it) => ({
            salesOrderItemId: it.salesOrderItemId, // carry SO line reference
            materialId: it.materialId,
            materialCode: it.materialCode,
            materialName: it.materialName,
            qty: it.actualQty,
            binId: it.binId,
            pickerId: it.pickerId,
          }));
        await tx.delivery.create({
          data: {
            deliveryCode,
            packingId: p.id,
            warehouseId: p.warehouseId,
            status: 'Open',
            items: { create: items },
          },
        });
        createdCodes.push(deliveryCode);
      }
    });

    this.logger.log(
      `Generated ${createdCodes.length} delivery(ies): ${createdCodes.join(', ')}`,
    );
    return { created: createdCodes.length, delivery_codes: createdCodes };
  }

  // ---------- generate shipment ----------

  // Generate the SDO ID once and close the delivery (moves it to History).
  // On close, the reserved qty of each item's (material, bin) is released from
  // Inventory — only reserved changes.
  async generateShipment(id: string, scope: WarehouseScope) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        items: { include: { salesOrderItem: { select: { lineNumber: true } } } },
        packing: {
          select: {
            picking: {
              select: { salesOrder: { select: { oracleId: true } } },
            },
          },
        },
      },
    });
    if (!d || (scope.role !== 'admin' && d.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    if (d.status === 'Closed' || d.sdoId) {
      throw new BadRequestException('Shipment already generated for this delivery');
    }

    // Build the Oracle Item Fulfillment payload from the delivery detail. Every
    // shippable item must map to a Sales Order line — reject otherwise.
    const salesOrderId = d.packing?.picking?.salesOrder?.oracleId ?? null;
    if (!salesOrderId) {
      throw new BadRequestException(
        'Sales Order Oracle ID not found for this delivery',
      );
    }
    const fulfillItems: { line: number; quantity: number }[] = [];
    for (const it of d.items) {
      if (!(it.qty > 0)) continue;
      const line = it.salesOrderItem?.lineNumber ?? null;
      if (line == null) {
        throw new BadRequestException(
          `Cannot ship: item "${it.materialCode ?? it.id}" has no Sales Order line number`,
        );
      }
      fulfillItems.push({ line, quantity: it.qty });
    }
    if (fulfillItems.length === 0) {
      throw new BadRequestException('No shippable items on this delivery');
    }

    // Hit Oracle first — if this fails, nothing below runs (delivery stays Open
    // and the user can retry).
    const fulfillment = await this.submitItemFulfillment(
      salesOrderId,
      fulfillItems,
    );

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.delivery.count({
      where: { sdoId: { startsWith: `SDO-${today}` } },
    });
    const sdoId = `SDO-${today}-${String(count + 1).padStart(3, '0')}`;

    // Atomic: close the delivery AND reduce reserved qty. Roll back if any fails.
    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id },
        data: {
          sdoId,
          status: 'Closed',
          oracleFulfillmentId: fulfillment?.fulfillment_id ?? null,
          oracleLocalId: fulfillment?.local_id ?? null,
        },
      });

      // Reduce Reserved Qty per (material, bin) by the delivery qty. Only reserved
      // changes; avail/on_hand/qty_issue/quality_issue stay put. Material-level
      // reserved is the sum of its bin stocks, so adjusting the bin stock covers
      // both the material and the bin (Inventory Detail).
      for (const it of d.items) {
        if (!it.materialCode || !(it.qty > 0)) continue;
        const inv = await tx.inventoryManagement.findFirst({
          where: { materialCode: it.materialCode, warehouseId: d.warehouseId },
          select: { id: true },
        });
        if (!inv) continue;
        await this.inventory.adjustBinStock(
          inv.id,
          it.binId,
          { reserved: -it.qty },
          tx,
        );
      }
    });

    this.logger.log(
      `Shipment generated for delivery ${d.deliveryCode}: ${sdoId} (Oracle fulfillment ${fulfillment?.fulfillment_id ?? '-'})`,
    );
    const detail = await this.findOne(id, scope);
    return {
      ...detail,
      fulfillment: {
        message: fulfillment?.message ?? 'Item Fulfillment created',
        fulfillment_id: fulfillment?.fulfillment_id ?? null,
        local_id: fulfillment?.local_id ?? null,
      },
    };
  }

  // ---------- serializers ----------

  private serializeList(d: DeliveryList) {
    const so = d.packing?.picking?.salesOrder;
    return {
      id: d.id,
      delivery_id: d.deliveryCode,
      sdo_id: d.sdoId,
      packing_id: d.packing?.packingCode ?? null,
      so_number: so?.tranId ?? null,
      customer: so?.customerName ?? null,
      location: d.warehouse?.name ?? null,
      status: d.status,
      item_count: d._count.items,
      created_at: d.createdAt,
    };
  }

  private serializeDetail(d: DeliveryDetail) {
    const packing = d.packing;
    const picking = packing?.picking;
    const so = picking?.salesOrder;
    return {
      id: d.id,
      delivery_id: d.deliveryCode,
      sdo_id: d.sdoId,
      packing_id: packing?.packingCode ?? null,
      so_id: so?.id ?? null,
      so_oracle_id: so?.oracleId ?? null,
      so_number: so?.tranId ?? null,
      customer: so?.customerName ?? null,
      location: d.warehouse?.name ?? null,
      status: d.status,
      oracle_fulfillment_id: d.oracleFulfillmentId ?? null,
      oracle_local_id: d.oracleLocalId ?? null,
      created_at: d.createdAt,
      // Full outbound tracking chain: Sales Order → Picking → Packing → Delivery.
      tracking: {
        so_id: so?.id ?? null,
        so_number: so?.tranId ?? null,
        customer: so?.customerName ?? null,
        picking_id: picking?.id ?? null,
        picking_code: picking?.pickingCode ?? null,
        picking_status: picking?.status ?? null,
        packing_id: packing?.id ?? null,
        packing_code: packing?.packingCode ?? null,
        delivery_code: d.deliveryCode,
        sdo_id: d.sdoId,
        delivery_status: d.status,
      },
      items: d.items
        .map((it) => ({
          id: it.id,
          line_number: it.salesOrderItem?.lineNumber ?? null,
          material_code: it.materialCode ?? it.material?.materialCode ?? null,
          material_name: it.materialName ?? it.material?.materialName ?? null,
          qty: it.qty,
          uom: it.material?.primaryUom?.uomCode ?? null,
          bin_label: it.bin?.binLabel ?? null,
          picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
        }))
        // Sort by Sales Order line number ASC; items without a line last.
        .sort((a, b) => {
          if (a.line_number == null && b.line_number == null) return 0;
          if (a.line_number == null) return 1;
          if (b.line_number == null) return -1;
          return a.line_number - b.line_number;
        }),
    };
  }
}
