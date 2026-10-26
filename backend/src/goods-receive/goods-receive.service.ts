import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateActualsDto } from './dto/update-actuals.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { loadPibMrn, pibMrnInclude, type PibMrn } from './gr-source.util';

export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

type GrOrder = Prisma.GoodsReceiveOrderByWithRelationInput;
const GR_SORTABLE: Record<string, (d: SortDir) => GrOrder> = {
  gr_number: (d) => ({ grNumber: d }),
  // The source document number is denormalized onto the GR now.
  shipment_number: (d) => ({ sourceDocNumber: d }),
  receiving_location: (d) => ({ warehouse: { name: d } }),
  status: (d) => ({ status: d }),
  created_at: (d) => ({ createdAt: d }),
};

const grInclude = {
  warehouse: { select: { id: true, name: true } },
  // Own received lines (PO / TO source). Empty for PIB (which uses MRN items).
  items: {
    orderBy: { lineNumber: 'asc' as const },
    include: { bin: { select: { binLabel: true } } },
  },
} satisfies Prisma.GoodsReceiveInclude;

// TO header shown on a TO-sourced GR detail.
const toHeaderSelect = {
  id: true,
  oracleId: true,
  tranId: true,
  statusName: true,
  fromLocationName: true,
  toLocationName: true,
  warehouse: { select: { name: true } },
} satisfies Prisma.TransferOrderSelect;
type ToHeader = Prisma.TransferOrderGetPayload<{ select: typeof toHeaderSelect }>;

// PO header shown on a PO-sourced GR detail.
const poHeaderSelect = {
  id: true,
  oracleId: true,
  poNumber: true,
  poDate: true,
  vendorName: true,
  poStatus: true,
  poStatusLabel: true,
  locationName: true,
} satisfies Prisma.PurchaseOrderSelect;
type PoHeader = Prisma.PurchaseOrderGetPayload<{ select: typeof poHeaderSelect }>;

type GrRow = Prisma.GoodsReceiveGetPayload<{ include: typeof grInclude }>;
// A GR with its source document (MRN for PIB) attached.
type GrWithSource = GrRow & { mrn: PibMrn | null };

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
      source?: string;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    // Default order: PO tab shows the newest GR first (createdAt); the PIB tab
    // keeps its shipment-number ordering.
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      GR_SORTABLE,
      query.source === 'PO' ? { createdAt: 'desc' } : { sourceDocNumber: 'desc' },
    );

    const where: Prisma.GoodsReceiveWhereInput = { ...this.scopeWhere(scope) };
    if (query.source) {
      where.sourceType = query.source as Prisma.GoodsReceiveWhereInput['sourceType'];
    }
    if (query.search) {
      where.OR = [
        { grNumber: { contains: query.search, mode: 'insensitive' } },
        { sourceDocNumber: { contains: query.search, mode: 'insensitive' } },
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

    // Batch-load the PIB source MRNs for this page (item count + receiving loc).
    const mrnIds = rows
      .filter((r) => r.sourceType === 'PIB')
      .map((r) => r.sourceDocId);
    const mrns = mrnIds.length
      ? await this.prisma.mrn.findMany({
          where: { id: { in: mrnIds } },
          include: pibMrnInclude,
        })
      : [];
    const mrnById = new Map(mrns.map((m) => [m.id, m]));

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) =>
        this.serializeList(r, mrnById.get(r.sourceDocId) ?? null),
      ),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const gr = await this.getScoped(id, scope);
    // PO source: attach the PO header (the GR detail shows it instead of MRN).
    const po =
      gr.sourceType === 'PO'
        ? await this.prisma.purchaseOrder.findUnique({
            where: { id: gr.sourceDocId },
            select: poHeaderSelect,
          })
        : null;
    // TO source: the Transfer Order being received.
    const to =
      gr.sourceType === 'TO'
        ? await this.prisma.transferOrder.findUnique({
            where: { id: gr.sourceDocId },
            select: toHeaderSelect,
          })
        : null;
    return this.serializeDetail(gr, po, to, await this.itemMaterials(gr));
  }

  // Fill the actual received quantity for the GR's items.
  async updateActuals(id: string, dto: UpdateActualsDto, scope: WarehouseScope) {
    const gr = await this.getScoped(id, scope);
    // TO source: the lines are the GR's own items (planned qty in `qty`).
    if (gr.sourceType === 'TO') {
      if (gr.status !== 'Open' && gr.status !== 'SyncFailed') {
        throw new BadRequestException(`Cannot edit a Goods Receive that is ${gr.status}`);
      }
      const byId = new Map(gr.items.map((it) => [it.id, it]));
      for (const row of dto.items) {
        const item = byId.get(row.id);
        if (!item) throw new BadRequestException(`Item ${row.id} is not part of this GR`);
        if (row.qtyActual > item.qty + 1e-9) {
          throw new BadRequestException(
            `Actual (${row.qtyActual}) cannot exceed planned (${item.qty}) for "${item.materialCode ?? item.itemDisplay ?? row.id}"`,
          );
        }
      }
      await this.prisma.$transaction(
        dto.items.map((row) =>
          this.prisma.goodsReceiveItem.update({
            where: { id: row.id },
            data: {
              qtyActual: row.qtyActual,
              ...(row.binId !== undefined ? { binId: row.binId } : {}),
            },
          }),
        ),
      );
      return this.findOne(id, scope);
    }
    const items = gr.mrn?.items ?? [];

    const itemById = new Map(items.map((it) => [it.id, it]));
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
    return this.serializeDetail(updated, null, null, await this.itemMaterials(updated));
  }

  private async getScoped(
    id: string,
    scope: WarehouseScope,
  ): Promise<GrWithSource> {
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
    const mrn = await loadPibMrn(this.prisma, gr);
    return { ...gr, mrn };
  }

  /**
   * PN (material code) and primary UoM for each received line, keyed by the
   * line's id: TO lines by their material, PIB (MRN) lines by Oracle item id.
   */
  private async itemMaterials(gr: GrWithSource) {
    const out = new Map<string, { code: string | null; uom: string | null }>();
    const select = { id: true, erpDocId: true, materialCode: true, primaryUom: { select: { uomCode: true } } };
    if (gr.sourceType === 'TO') {
      const ids = gr.items.map((it) => it.materialId).filter((v): v is string => !!v);
      const mats = ids.length ? await this.prisma.material.findMany({ where: { id: { in: ids } }, select }) : [];
      const byId = new Map(mats.map((m) => [m.id, m]));
      for (const it of gr.items) {
        const m = it.materialId ? byId.get(it.materialId) : undefined;
        out.set(it.id, { code: it.materialCode ?? m?.materialCode ?? null, uom: m?.primaryUom?.uomCode ?? null });
      }
      return out;
    }
    const items = gr.mrn?.items ?? [];
    const erpIds = [...new Set(items.map((it) => it.itemId).filter((v): v is number => v != null))].map(String);
    const mats = erpIds.length
      ? await this.prisma.material.findMany({ where: { erpDocId: { in: erpIds } }, select })
      : [];
    const byErp = new Map(mats.map((m) => [m.erpDocId, m]));
    for (const it of items) {
      const m = it.itemId != null ? byErp.get(String(it.itemId)) : undefined;
      out.set(it.id, { code: m?.materialCode ?? null, uom: m?.primaryUom?.uomCode ?? null });
    }
    return out;
  }

  private serializeList(gr: GrRow, mrn: PibMrn | null) {
    return {
      id: gr.id,
      gr_number: gr.grNumber,
      status: gr.status,
      source_type: gr.sourceType,
      shipment_number: gr.sourceDocNumber,
      receiving_location_name: mrn?.receivingLocationName ?? (gr.sourceType === 'TO' ? (gr.warehouse?.name ?? null) : null),
      warehouse: gr.warehouse,
      item_count: mrn?.items.length ?? gr.items.length,
      created_at: gr.createdAt,
    };
  }

  // Goods Receive hides shipment amount and all *_id fields (names only).
  private serializeDetail(
    gr: GrWithSource,
    po: PoHeader | null = null,
    to: ToHeader | null = null,
    materials = new Map<string, { code: string | null; uom: string | null }>(),
  ) {
    const m = gr.mrn;
    return {
      id: gr.id,
      gr_number: gr.grNumber,
      status: gr.status,
      source_type: gr.sourceType,
      warehouse: gr.warehouse,
      // PO header (PO source only) + the received lines submitted to Oracle.
      po: po
        ? {
            id: po.id,
            oracle_id: po.oracleId,
            po_number: po.poNumber,
            po_date: po.poDate,
            vendor_name: po.vendorName,
            po_status: po.poStatus,
            po_status_label: po.poStatusLabel,
            location_name: po.locationName,
          }
        : null,
      po_items: gr.items.map((it) => ({
        id: it.id,
        line_number: it.lineNumber,
        item_display: it.itemDisplay,
        qty_actual: it.qty,
      })),
      // TO header (TO source only).
      to: to
        ? {
            id: to.id,
            oracle_id: to.oracleId,
            tran_id: to.tranId,
            status_name: to.statusName,
            origin_warehouse: to.warehouse?.name ?? to.fromLocationName,
            destination_warehouse: gr.warehouse?.name ?? to.toLocationName,
          }
        : null,
      // MRN information shown on the Goods Receive screen (PIB source).
      mrn: m
        ? {
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
          }
        : null,
      shipment_number: gr.sourceDocNumber,
      // TO source: received at the destination warehouse.
      receiving_location_name: m?.receivingLocationName ?? (gr.sourceType === 'TO' ? (gr.warehouse?.name ?? null) : null),
      // TO source: the received lines in the same shape as MRN items, so the
      // receive/putaway screen reads them the same way.
      items: gr.sourceType === 'TO'
        ? gr.items.map((it) => ({
            id: it.id,
            item_name: it.materialCode ?? it.itemDisplay,
            po_number: to?.tranId ?? null,
            vendor_name: to ? (to.warehouse?.name ?? to.fromLocationName) : null,
            item_description: it.itemDisplay,
            qty_expected: it.qty,
            qty_actual: it.qtyActual,
            qty_remaining: it.qtyRemaining,
            bin_id: it.binId,
            bin_label: it.bin?.binLabel ?? null,
            receiving_location_name: gr.warehouse?.name ?? null,
            line_number: it.lineNumber,
            material_code: materials.get(it.id)?.code ?? it.materialCode,
            uom: materials.get(it.id)?.uom ?? null,
          }))
        : (m?.items ?? []).map((it) => ({
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
        material_code: materials.get(it.id)?.code ?? null,
        uom: materials.get(it.id)?.uom ?? null,
      })),
      created_at: gr.createdAt,
    };
  }
}
