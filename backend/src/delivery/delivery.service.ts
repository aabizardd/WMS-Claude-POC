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
import { highestSeq } from '../common/doc-sequence';
import { InventoryService } from '../inventory/inventory.service';
import { reopenPacking } from '../common/outbound-revert';
import type { GenerateDeliveryDto } from './dto/generate-delivery.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string };
}

interface ItemFulfillmentResponse {
  success: boolean;
  data?: {
    status?: string;
    fulfillment_id?: number;
    local_id?: number;
    // Oracle's document number for the created fulfillment — becomes the SDO ID.
    document_no?: string | number;
  };
  message?: string;
  // Tolerated if the bridge returns it at the top level instead of under data.
  document_no?: string | number;
}

export interface WarehouseScope {
  // Controllers pass the full AuthUser, so the acting user is available for the
  // stock ledger; optional because older call sites do not set it.
  userId?: number;
  role: string;
  warehouseId: string | null;
}

/** Where a picking line was taken from: the bin it was picked out of. */
const pickedFromSelect = {
  salesOrderItemId: true,
  transferOrderItemId: true,
  actualQty: true,
  bin: { select: { binLabel: true } },
} satisfies Prisma.PickingItemSelect;

const packingSelect = {
  id: true,
  packingCode: true,
  picking: {
    select: {
      id: true,
      pickingCode: true,
      status: true,
      salesOrder: {
        select: {
          id: true,
          oracleId: true,
          tranId: true,
          customerName: true,
          subsidiaryName: true,
        },
      },
      transferOrder: {
        select: {
          id: true,
          oracleId: true,
          tranId: true,
          toLocationName: true,
        },
      },
      items: { select: pickedFromSelect },
    },
  },
  // Pickings consolidated into this packing besides its own.
  pickings: { select: { items: { select: pickedFromSelect } } },
} satisfies Prisma.PackingSelect;

const userName = { select: { id: true, name: true } } as const;

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  packing: { select: packingSelect },
  createdBy: userName,
  updatedBy: userName,
  _count: { select: { items: true } },
} satisfies Prisma.DeliveryInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  packing: { select: packingSelect },
  createdBy: userName,
  updatedBy: userName,
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
      transferOrderItem: { select: { lineNumber: true } },
      // A delivery can cover several packings; the line says which.
      packing: { select: { id: true, packingCode: true } },
      bin: { select: { id: true, binLabel: true } },
      pickingItem: { select: { bin: { select: { binLabel: true } } } },
      picker: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.DeliveryInclude;

type DeliveryList = Prisma.DeliveryGetPayload<{ include: typeof listInclude }>;
type DeliveryDetail = Prisma.DeliveryGetPayload<{
  include: typeof detailInclude;
}>;

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
  updated_at: (d) => ({ updatedAt: d }),
  created_by: (d) => ({ createdBy: { name: d } }),
};

/** SO or TO behind a delivery, for filters that look at the source document. */
const viaSalesOrder = (w: Prisma.SalesOrderWhereInput): Prisma.DeliveryWhereInput => ({
  packing: { picking: { salesOrder: w } },
});
const viaTransferOrder = (w: Prisma.TransferOrderWhereInput): Prisma.DeliveryWhereInput => ({
  packing: { picking: { transferOrder: w } },
});
const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

/**
 * Tracking filters, one per field. Several values on one field are OR-ed;
 * different fields are AND-ed. Item fields look inside the delivery's lines.
 */
const DELIVERY_FILTERS: Record<string, (v: string) => Prisma.DeliveryWhereInput> = {
  material_code: (v) => ({ items: { some: { materialCode: ci(v) } } }),
  material_name: (v) => ({ items: { some: { materialName: ci(v) } } }),
  warehouse_id: (v) => ({ warehouseId: v }),
  // Transfer Order deliveries only: the TO's destination warehouse.
  to_warehouse_id: (v) => viaTransferOrder({ toWarehouseId: v }),
  // Free-text versions of the fields above, matched on names.
  warehouse_name: (v) => ({ warehouse: { name: ci(v) } }),
  to_warehouse_name: (v) => viaTransferOrder({ toLocationName: ci(v) }),
  customer_name: (v) => viaSalesOrder({ customerName: ci(v) }),
  created_by_name: (v) => ({ createdBy: { name: ci(v) } }),
  sdo_id: (v) => ({ sdoId: ci(v) }),
  tran_id: (v) => ({
    OR: [viaSalesOrder({ tranId: ci(v) }), viaTransferOrder({ tranId: ci(v) })],
  }),
  // Value is the customer's Oracle id (the master's oracleId).
  customer_id: (v) => viaSalesOrder({ customerId: v }),
  oracle_id: (v) => ({
    OR: [viaSalesOrder({ oracleId: ci(v) }), viaTransferOrder({ oracleId: ci(v) })],
  }),
  packing_code: (v) => ({ packing: { packingCode: ci(v) } }),
  created_by_id: (v) => ({ createdById: /^\d+$/.test(v) ? Number(v) : -1 }),
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
    transactionType: 'sales_order' | 'transfer_order',
    transactionId: string,
    items: { line: number; quantity: number }[],
  ): Promise<ItemFulfillmentResponse['data'] & { message?: string }> {
    // transaction_type is one of sales_order | transfer_order | vendor_return;
    // transaction_id is the source doc's Oracle id.
    const payload = {
      transaction_type: transactionType,
      transaction_id: transactionId,
      ship_status: 'shipped',
      items,
    };
    const url = `${this.baseUrl()}/items/item-fulfillment`;
    // TEMP DIAGNOSTIC: log exactly what WMS sends (token excluded).
    this.logger.warn(`[ItemFulfillment] REQUEST ${url} ${JSON.stringify(payload)}`);

    let res: Response;
    let raw = '';
    try {
      const token = await this.getAccessToken();
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      raw = await res.text();
    } catch (e) {
      this.logger.error(`[ItemFulfillment] NETWORK ERROR ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        `Failed to reach Oracle Item Fulfillment: ${(e as Error).message}`,
      );
    }

    // TEMP DIAGNOSTIC: log the raw Oracle response.
    this.logger.warn(`[ItemFulfillment] RESPONSE HTTP ${res.status} ${raw}`);

    let json: ItemFulfillmentResponse | null = null;
    try {
      json = JSON.parse(raw) as ItemFulfillmentResponse;
    } catch {
      json = null;
    }
    if (!res.ok || !json?.success) {
      throw new ServiceUnavailableException(
        json?.message ?? `Oracle Item Fulfillment failed (HTTP ${res.status})`,
      );
    }
    // Only reached on a success response, so document_no is never read from a
    // failed call. Accept it under data or at the top level.
    return {
      ...json.data,
      document_no: json.data?.document_no ?? json.document_no,
      message: json.message,
    };
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
      /** "all" lists every status (Delivery Plan, SD Tracking). */
      status?: string;
      source?: string;
      filters?: { field: string; values: string[] }[];
      sort_by?: string;
      sort_order?: string;
      /** 'true' adds each delivery's lines to its row (the list's accordion). */
      include_items?: string;
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
      ...(query.status === 'all' ? {} : { status: isHistory ? 'Closed' : { not: 'Closed' } }),
    };
    if (query.source === 'SALES_ORDER' || query.source === 'TRANSFER_ORDER') {
      where.sourceType = query.source;
    }
    if (query.search) {
      where.OR = [
        { deliveryCode: { contains: query.search, mode: 'insensitive' } },
        { sdoId: { contains: query.search, mode: 'insensitive' } },
        {
          packing: {
            packingCode: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          packing: {
            picking: {
              salesOrder: {
                tranId: { contains: query.search, mode: 'insensitive' },
              },
            },
          },
        },
        {
          packing: {
            picking: {
              transferOrder: {
                tranId: { contains: query.search, mode: 'insensitive' },
              },
            },
          },
        },
        { warehouse: { name: ci(query.search) } },
        viaSalesOrder({ customerName: ci(query.search) }),
        viaTransferOrder({ toLocationName: ci(query.search) }),
      ];
    }

    const and: Prisma.DeliveryWhereInput[] = [];
    for (const f of query.filters ?? []) {
      const build = DELIVERY_FILTERS[f.field];
      const values = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
      if (build && values.length) and.push({ OR: values.map(build) });
    }
    if (and.length) where.AND = and;

    const withItems = query.include_items === 'true';
    const [total, rows, qtySum] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        include: withItems ? { ...listInclude, items: detailInclude.items } : listInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      // Quantity of every matching delivery, not only this page.
      this.prisma.deliveryItem.aggregate({
        where: { delivery: where },
        _sum: { qty: true },
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      totals: { qty: qtySum._sum.qty ?? 0 },
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) => ({
        ...this.serializeList(r),
        ...('items' in r
          ? { items: this.serializeItems(r.items as DeliveryDetail['items'], r.packing) }
          : {}),
      })),
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
      include: {
        items: true,
        deliveries: { select: { id: true } },
        // A packing may also be covered by a delivery it is not the primary of.
        deliveryItems: { select: { id: true }, take: 1 },
      },
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
      if (p.deliveries.length || p.deliveryItems.length) {
        throw new BadRequestException(`Packing ${p.packingCode} already has a delivery document`);
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseCount = highestSeq(
      (
        await this.prisma.delivery.findMany({
          where: { deliveryCode: { startsWith: `DEL-${today}` } },
          select: { deliveryCode: true },
        })
      ).map((r) => r.deliveryCode),
    );

    /**
     * Packings that belong together ship together: same warehouse and same
     * source document become ONE delivery covering several packings. Anything
     * else still gets its own, so unrelated orders are never merged.
     */
    const pickings = await this.prisma.picking.findMany({
      where: { id: { in: packings.map((p) => p.pickingId) } },
      select: { id: true, salesOrderId: true, transferOrderId: true },
    });
    const pickingById = new Map(pickings.map((pk) => [pk.id, pk]));
    const sourceById = new Map(
      packings.map((p) => [p.id, pickingById.get(p.pickingId)]),
    );

    const groups = new Map<string, typeof packings>();
    for (const id of dto.packingIds) {
      const p = byId.get(id)!;
      // A packing reaches its order through its primary picking.
      const src = sourceById.get(p.id);
      const sourceKey =
        p.sourceType === 'TRANSFER_ORDER'
          ? `TO:${src?.transferOrderId ?? p.id}`
          : `SO:${src?.salesOrderId ?? p.id}`;
      const key = `${p.warehouseId ?? '-'}|${p.sourceType}|${sourceKey}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(p);
      else groups.set(key, [p]);
    }

    const createdCodes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      let seq = baseCount;
      for (const group of groups.values()) {
        seq += 1;
        const deliveryCode = `DEL-${today}-${String(seq).padStart(3, '0')}`;
        const first = group[0];
        // Carry the actually-packed qty (per item) into the delivery. Items with
        // nothing packed (all issue) are skipped.
        const items = group.flatMap((p) =>
          p.items
            .filter((it) => it.actualQty > 0)
            .map((it) => ({
              // Carry the source line reference (SO or TO) through from packing.
              salesOrderItemId: it.salesOrderItemId,
              transferOrderItemId: it.transferOrderItemId,
              materialId: it.materialId,
              materialCode: it.materialCode,
              materialName: it.materialName,
              qty: it.actualQty,
              binId: it.binId,
              pickingItemId: it.pickingItemId, // the picking line, for its Picking Bin
              pickerId: it.pickerId,
              // Which packing this line came from.
              packingId: p.id,
            })),
        );
        await tx.delivery.create({
          data: {
            deliveryCode,
            sourceType: first.sourceType, // inherit source from the packing
            packingId: first.id,
            warehouseId: first.warehouseId,
            status: 'Open',
            createdById: scope.userId ?? null,
            updatedById: scope.userId ?? null,
            items: { create: items },
          },
        });
        createdCodes.push(deliveryCode);
      }
    });

    this.logger.log(`Generated ${createdCodes.length} delivery(ies): ${createdCodes.join(', ')}`);
    return { created: createdCodes.length, delivery_codes: createdCodes };
  }

  // ---------- delete ----------

  /**
   * Delete an Open delivery plan (no shipment generated yet). Every packing it
   * covers goes back to Open with its progress cleared, so it is packed again:
   * the stock a closed packing had moved into the issue buckets returns to
   * Reserved and its discrepancies are removed. Generating the plan itself
   * moved no stock.
   */
  async remove(id: string, scope: WarehouseScope) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: { items: { select: { packingId: true } } },
    });
    if (!d || (scope.role !== 'admin' && d.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    if (d.status !== 'Open' || d.sdoId) {
      throw new BadRequestException(
        'Only an Open delivery plan without a shipment can be deleted',
      );
    }

    const packingIds = [
      ...new Set([d.packingId, ...d.items.map((it) => it.packingId)].filter((v): v is string => !!v)),
    ];
    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.delete({ where: { id } });
      for (const packingId of packingIds) {
        await reopenPacking(
          tx,
          this.inventory,
          packingId,
          scope.userId,
          `Delivery plan ${d.deliveryCode} deleted — packing reopened`,
        );
      }
    });

    this.logger.log(
      `Delivery ${d.deliveryCode} deleted; ${packingIds.length} packing(s) reopened`,
    );
    return { deleted: true, reopened_packings: packingIds.length };
  }

  // ---------- generate shipment ----------

  // Generate the SDO ID once and close the delivery (moves it to History).
  // On close, the reserved qty of each item's (material, bin) is released from
  // Inventory — only reserved changes.
  async generateShipment(id: string, scope: WarehouseScope) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            salesOrderItem: { select: { lineNumber: true } },
            transferOrderItem: { select: { lineNumber: true } },
          },
        },
        packing: {
          select: {
            picking: {
              select: {
                salesOrder: { select: { oracleId: true } },
                transferOrder: { select: { oracleId: true } },
              },
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

    // Build the Oracle Item Fulfillment payload from the delivery detail. The
    // source (Sales Order or Transfer Order) drives transaction_type + line map.
    const isTransfer = d.sourceType === 'TRANSFER_ORDER';
    const transactionType = isTransfer ? 'transfer_order' : 'sales_order';
    const sourceOracleId = isTransfer
      ? (d.packing?.picking?.transferOrder?.oracleId ?? null)
      : (d.packing?.picking?.salesOrder?.oracleId ?? null);
    if (!sourceOracleId) {
      throw new BadRequestException(
        `${isTransfer ? 'Transfer Order' : 'Sales Order'} Oracle ID not found for this delivery`,
      );
    }
    // Pre-processing: group the delivery items by source line and sum their qty.
    // One source line can produce several delivery items (a material picked from
    // more than one bin), but Oracle rejects a payload with duplicate lines — so
    // the request carries one record per line with the summed quantity.
    const qtyByLine = new Map<number, number>();
    for (const it of d.items) {
      if (!(it.qty > 0)) continue;
      const line = isTransfer
        ? (it.transferOrderItem?.lineNumber ?? null)
        : (it.salesOrderItem?.lineNumber ?? null);
      if (line == null) {
        throw new BadRequestException(
          `Cannot ship: item "${it.materialCode ?? it.id}" has no source line number`,
        );
      }
      qtyByLine.set(line, (qtyByLine.get(line) ?? 0) + it.qty);
    }
    const fulfillItems = [...qtyByLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, quantity]) => ({ line, quantity }));
    if (fulfillItems.length === 0) {
      throw new BadRequestException('No shippable items on this delivery');
    }

    // Hit Oracle first — if this fails, nothing below runs (delivery stays Open
    // and the user can retry).
    const fulfillment = await this.submitItemFulfillment(
      transactionType,
      sourceOracleId,
      fulfillItems,
    );

    // The SDO ID is Oracle's document_no for the fulfillment just created. Only
    // a success response reaches this point (a failure throws above, leaving the
    // delivery Open with no SDO ID). If a successful response omits document_no,
    // fall back to the internal counter — the fulfillment already exists in
    // Oracle, so failing here would strand the delivery and a retry would post a
    // duplicate.
    let sdoId = fulfillment?.document_no != null ? String(fulfillment.document_no).trim() : '';
    if (!sdoId) {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await this.prisma.delivery.count({
        where: { sdoId: { startsWith: `SDO-${today}` } },
      });
      sdoId = `SDO-${today}-${String(count + 1).padStart(3, '0')}`;
      this.logger.warn(
        `[ItemFulfillment] success without document_no — falling back to generated SDO ${sdoId}`,
      );
    }

    // Atomic: close the delivery AND reduce reserved qty. Roll back if any fails.
    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id },
        data: {
          sdoId,
          status: 'Closed',
          updatedById: scope.userId ?? null,
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
          {
            module: 'delivery',
            id: d.id,
            number: d.deliveryCode,
            actorId: scope.userId,
            note: 'Shipped — reservation released',
          },
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
    const to = d.packing?.picking?.transferOrder;
    return {
      id: d.id,
      delivery_id: d.deliveryCode,
      sdo_id: d.sdoId,
      source_type: d.sourceType,
      packing_id: d.packing?.packingCode ?? null,
      // Every packing this delivery covers — it can be more than one.
      packing_codes:
        'items' in d
          ? this.packingCodes(d.items as DeliveryDetail['items'])
          : d.packing?.packingCode
            ? [d.packing.packingCode]
            : [],
      so_number: so?.tranId ?? null,
      to_number: to?.tranId ?? null,
      source_number: so?.tranId ?? to?.tranId ?? null,
      customer: so?.customerName ?? to?.toLocationName ?? null,
      location: d.warehouse?.name ?? null,
      status: d.status,
      item_count: d._count.items,
      ...this.auditFields(d),
    };
  }

  /**
   * The bins each order line was picked from, keyed by its Sales / Transfer
   * Order line id. Only bins something was actually taken out of count.
   */
  private pickedFrom(packing: DeliveryList['packing']) {
    const rows = [
      ...(packing?.picking?.items ?? []),
      ...(packing?.pickings ?? []).flatMap((p) => p.items),
    ];
    const byLine = new Map<string, Set<string>>();
    for (const r of rows) {
      const line = r.salesOrderItemId ?? r.transferOrderItemId;
      if (!line || !r.bin || r.actualQty <= 0) continue;
      if (!byLine.has(line)) byLine.set(line, new Set());
      byLine.get(line)!.add(r.bin.binLabel);
    }
    return byLine;
  }

  /** Fields the Delivery Plan list, tracking and detail all show. */
  private auditFields(d: DeliveryList | DeliveryDetail) {
    const so = d.packing?.picking?.salesOrder;
    const to = d.packing?.picking?.transferOrder;
    return {
      packing_db_id: d.packing?.id ?? null,
      erp_doc_id: so?.oracleId ?? to?.oracleId ?? null,
      ownership: so?.subsidiaryName ?? null,
      created_by: d.createdBy?.name ?? null,
      created_at: d.createdAt,
      updated_by: d.updatedBy?.name ?? null,
      updated_at: d.updatedAt,
    };
  }

  /**
   * Dropdown values for SD Tracking, from the masters: active warehouses of the
   * allowed subsidiary, customers and active users.
   */
  async trackingOptions() {
    const [warehouses, customers, users] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isInactive: false, subsidiaryId: subsidiarySingleFilter() },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.customer.findMany({
        orderBy: { companyName: 'asc' },
        select: { oracleId: true, entityId: true, companyName: true },
      }),
      this.prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return {
      warehouses,
      customers: customers.map((c) => ({
        id: c.oracleId,
        // entityId usually already reads "CODE - NAME"; only add the name
        // when it is not part of it.
        name:
          c.entityId && c.companyName && !c.entityId.includes(c.companyName)
            ? `${c.entityId} - ${c.companyName}`
            : c.entityId || c.companyName || c.oracleId,
      })),
      creators: users.map((u) => ({ id: String(u.id), name: u.name })),
    };
  }

  private serializeDetail(d: DeliveryDetail) {
    const packing = d.packing;
    const picking = packing?.picking;
    const so = picking?.salesOrder;
    const to = picking?.transferOrder;
    return {
      id: d.id,
      delivery_id: d.deliveryCode,
      sdo_id: d.sdoId,
      source_type: d.sourceType,
      packing_id: packing?.packingCode ?? null,
      // Every packing this delivery covers — it can be more than one.
      packing_codes: this.packingCodes(d.items),
      so_id: so?.id ?? null,
      so_oracle_id: so?.oracleId ?? null,
      so_number: so?.tranId ?? null,
      to_id: to?.id ?? null,
      to_oracle_id: to?.oracleId ?? null,
      to_number: to?.tranId ?? null,
      source_number: so?.tranId ?? to?.tranId ?? null,
      customer: so?.customerName ?? to?.toLocationName ?? null,
      location: d.warehouse?.name ?? null,
      status: d.status,
      oracle_fulfillment_id: d.oracleFulfillmentId ?? null,
      oracle_local_id: d.oracleLocalId ?? null,
      ...this.auditFields(d),
      // Full outbound tracking chain: source doc → Picking → Packing → Delivery.
      // The first step is the Sales Order or the Transfer Order, per source_type.
      tracking: {
        source_type: d.sourceType,
        so_id: so?.id ?? null,
        so_number: so?.tranId ?? null,
        to_id: to?.id ?? null,
        to_number: to?.tranId ?? null,
        // Customer for SO; destination warehouse for TO.
        customer: so?.customerName ?? to?.toLocationName ?? null,
        picking_id: picking?.id ?? null,
        picking_code: picking?.pickingCode ?? null,
        picking_status: picking?.status ?? null,
        packing_id: packing?.id ?? null,
        packing_code: packing?.packingCode ?? null,
        delivery_code: d.deliveryCode,
        sdo_id: d.sdoId,
        delivery_status: d.status,
      },
      items: this.serializeItems(d.items, d.packing),
    };
  }

  /** Distinct packing codes across a delivery's lines, in first-seen order. */
  private packingCodes(items: DeliveryDetail['items']): string[] {
    const seen: string[] = [];
    for (const it of items) {
      const code = it.packing?.packingCode;
      if (code && !seen.includes(code)) seen.push(code);
    }
    return seen;
  }

  /** A delivery's lines, in Sales / Transfer Order line order. */
  private serializeItems(items: DeliveryDetail['items'], packing: DeliveryList['packing']) {
    const picked = this.pickedFrom(packing);
    return (
      items
        .map((it) => ({
          id: it.id,
          line_number: it.salesOrderItem?.lineNumber ?? it.transferOrderItem?.lineNumber ?? null,
          material_code: it.materialCode ?? it.material?.materialCode ?? null,
          material_name: it.materialName ?? it.material?.materialName ?? null,
          // Shown per line on the print-out, since one document can mix them.
          packing_id: it.packing?.id ?? null,
          packing_code: it.packing?.packingCode ?? null,
          qty: it.qty,
          uom: it.material?.primaryUom?.uomCode ?? null,
          // Staging bin: a line-level field; the header no longer carries one.
          bin_label: it.bin?.binLabel ?? null,
          // The bins this line was picked from.
          picked_bins: it.pickingItem?.bin
            ? [it.pickingItem.bin.binLabel]
            : [...(picked.get(it.salesOrderItemId ?? it.transferOrderItemId ?? '') ?? [])].slice(0, 1),
          picker: it.picker ? { id: it.picker.id, name: it.picker.name } : null,
        }))
        // Sort by Sales Order line number ASC; items without a line last.
        .sort((a, b) => {
          if (a.line_number == null && b.line_number == null) return 0;
          if (a.line_number == null) return 1;
          if (b.line_number == null) return -1;
          return a.line_number - b.line_number;
        })
    );
  }
}
