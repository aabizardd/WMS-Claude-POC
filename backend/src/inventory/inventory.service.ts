import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustBinsDto } from './dto/adjust-bins.dto';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import { isFrozenBinLabel } from '../common/frozen-bins';
import type {
  InventoryFilterDto,
  InventoryFilterField,
} from './dto/query-inventory.dto';
import { loadPibMrn } from '../goods-receive/gr-source.util';

type InvOrder = Prisma.InventoryManagementOrderByWithRelationInput;
// Only real columns are server-sortable; the quantity columns are aggregates
// computed from bin stocks and cannot be ordered by Prisma.
const INVENTORY_SORTABLE: Record<string, (d: SortDir) => InvOrder> = {
  material_code: (d) => ({ materialCode: d }),
  material_name: (d) => ({ material: { materialName: d } }),
  material_type: (d) => ({ material: { materialType: { materialTypeName: d } } }),
  material_category: (d) => ({
    material: { materialCategory: { materialCategoryName: d } },
  }),
  primary_uom: (d) => ({ material: { primaryUom: { uomCode: d } } }),
  warehouse_name: (d) => ({ warehouse: { name: d } }),
};

// How each filterable column maps to a Prisma predicate. Every filter is a
// case-insensitive "contains", including Bin, which matches a material that has
// at least one bin whose label contains the text.
const INVENTORY_FILTERS: Record<
  InventoryFilterField,
  (v: string) => Prisma.InventoryManagementWhereInput
> = {
  material_code: (v) => ({ materialCode: { contains: v, mode: 'insensitive' } }),
  material_name: (v) => ({
    material: { materialName: { contains: v, mode: 'insensitive' } },
  }),
  material_type: (v) => ({
    material: {
      materialType: { materialTypeName: { contains: v, mode: 'insensitive' } },
    },
  }),
  material_category: (v) => ({
    material: {
      materialCategory: {
        materialCategoryName: { contains: v, mode: 'insensitive' },
      },
    },
  }),
  primary_uom: (v) => ({
    material: { primaryUom: { uomCode: { contains: v, mode: 'insensitive' } } },
  }),
  // Exact: the value comes from the warehouse dropdown, which sends ids.
  warehouse_id: (v) => ({ warehouseId: v }),
  // Free text on the warehouse name (the list's filter field).
  warehouse_name: (v) => ({ warehouse: { name: { contains: v, mode: 'insensitive' } } }),
  bin: (v) => ({
    binStocks: {
      some: { bin: { binLabel: { contains: v, mode: 'insensitive' } } },
    },
  }),
};

/** One SO / TO document behind a Reserved or In Transit quantity. */
export interface DocRow {
  doc_type: 'SO' | 'TO';
  doc_id: string;
  doc_number: string | null;
  erp_doc_id: string | null;
  status: string | null;
  /** Customer (SO), destination (reserved TO) or origin (in-transit TO). */
  party: string | null;
  /** Picking codes holding the reservation (reserved) or delivery codes (in transit). */
  references: string[];
  /** Packing codes of those lines; empty before packing. */
  packing_ids: string[];
  /** The material and warehouse the row is about (the all-documents page). */
  material_code?: string | null;
  material_name?: string | null;
  warehouse_name?: string | null;
  /** Reserved only: the pickings and packings, with ids for links. */
  pickings?: { id: string; code: string }[];
  packings?: { id: string; code: string }[];
  /** In Transit only: the shipped deliveries, by SD number (id = delivery id). */
  sds?: { id: string; code: string }[];
  /** In Transit only: shipped by those SDs, and received at the destination (TO In). */
  qty_delivered?: number;
  qty_received?: number;
  qty: number;
  /** Reserved only: what picking holds (picked, or requested while open). */
  qty_picking?: number;
  /** Reserved only: what closed packings actually packed; null before packing. */
  qty_packing?: number | null;
  /** Reserved only: picked but not packed — released from reserved. */
  packing_diff?: number;
}

/** Cancelled SO / TO hold no Reserved or In Transit stock of their own. */
const isCancelled = (status: string | null) => /cancel/i.test(status ?? '');

export interface WarehouseScope {
  // Controllers pass the full AuthUser, so the acting user is available for the
  // stock ledger; optional because older call sites do not set it.
  userId?: number;
  role: string;
  warehouseId: string | null;
}

const materialInclude = {
  material: {
    include: {
      materialType: { select: { materialTypeName: true } },
      materialCategory: { select: { materialCategoryName: true } },
      primaryUom: { select: { uomCode: true, uomName: true } },
      secondaryUom: { select: { uomCode: true, uomName: true } },
    },
  },
  warehouse: { select: { id: true, name: true } },
} satisfies Prisma.InventoryManagementInclude;

const listInclude = {
  ...materialInclude,
  binStocks: {
    select: {
      reservedQty: true,
      availQty: true,
      inTransitQty: true,
      qualityIssue: true,
      qtyIssue: true,
      // Only the label: enough to split frozen (KIT) stock out of Available.
      bin: { select: { binLabel: true } },
    },
  },
} satisfies Prisma.InventoryManagementInclude;

const detailInclude = {
  ...materialInclude,
  binStocks: {
    include: { bin: { select: { binLabel: true, binCode: true, isVirtual: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.InventoryManagementInclude;

type InvList = Prisma.InventoryManagementGetPayload<{
  include: typeof listInclude;
}>;
type InvDetail = Prisma.InventoryManagementGetPayload<{
  include: typeof detailInclude;
}>;

interface StockDelta {
  avail?: number;
  reserved?: number;
  inTransit?: number;
  quality?: number;
  qtyIssue?: number;
}

/** Who/what caused a stock movement — required on every adjustBinStock call. */
export interface StockMovementSource {
  module:
    | 'inventory-adjustment'
    | 'goods-receive'
    | 'putaway'
    | 'picking'
    | 'packing'
    | 'delivery'
    | 'manual'
    | 'erp-sync';
  /** Primary key of the source document. */
  id?: string | null;
  /** Human-readable document number, so the ledger reads without a join. */
  number?: string | null;
  actorId?: number | null;
  note?: string | null;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  private scopeWhere(scope: WarehouseScope): Prisma.InventoryManagementWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  // ---------- read ----------

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      filters?: InventoryFilterDto[];
      include_bins?: string;
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const withBins = query.include_bins === 'true';
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      INVENTORY_SORTABLE,
      { materialCode: 'asc' },
    );

    const where: Prisma.InventoryManagementWhereInput = {
      ...this.scopeWhere(scope),
      // Stock held in a site outside the allowed subsidiary is not listed. A
      // single row stays reachable by id, so existing links keep working.
      warehouse: { subsidiaryId: subsidiarySingleFilter() },
    };
    if (query.search) {
      where.OR = [
        { materialCode: { contains: query.search, mode: 'insensitive' } },
        {
          material: {
            materialName: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Per-column filters, combined with AND: a row must satisfy every one of
    // them. Several values on one column are OR-ed, so one filter widens while
    // adding another filter narrows.
    const filters = (query.filters ?? [])
      .map((f) => ({
        field: f.field,
        values: (f.values ?? []).map((v) => v.trim()).filter(Boolean),
      }))
      .filter((f) => f.values.length);
    if (filters.length) {
      where.AND = filters.map((f) => ({
        OR: f.values.map((v) => INVENTORY_FILTERS[f.field](v)),
      }));
    }

    const [total, rows, all] = await this.prisma.$transaction([
      this.prisma.inventoryManagement.count({ where }),
      this.prisma.inventoryManagement.findMany({
        where,
        // The detail shape carries the bin labels/codes the breakdown needs.
        include: withBins ? detailInclude : listInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      // Every matching row (not just this page), for the totals line.
      this.prisma.inventoryManagement.findMany({
        where,
        select: {
          warehouseId: true,
          materialId: true,
          binStocks: {
            select: {
              reservedQty: true,
              availQty: true,
              inTransitQty: true,
              qualityIssue: true,
              qtyIssue: true,
              bin: { select: { binLabel: true } },
            },
          },
        },
      }),
    ]);

    // In Transit for every matching row (which covers this page too).
    const inTransit = await this.outboundInTransit(all);

    // Same figures as each row shows, summed over the whole result.
    const totals = all.reduce(
      (t, m) => {
        const q = this.headerQuantities(m.binStocks);
        return {
          on_hand: t.on_hand + q.on_hand,
          avail_qty: t.avail_qty + q.avail_qty,
          freeze_qty: t.freeze_qty + q.freeze_qty,
          qty_issue: t.qty_issue + q.qty_issue,
          quality_issue: t.quality_issue + q.quality_issue,
          reserved_qty: t.reserved_qty + q.reserved_qty,
          // In Transit is tracked at header level, as on each row.
          in_transit_qty: t.in_transit_qty + this.inTransitOf(inTransit, m),
        };
      },
      {
        on_hand: 0,
        avail_qty: 0,
        freeze_qty: 0,
        qty_issue: 0,
        quality_issue: 0,
        reserved_qty: 0,
        in_transit_qty: 0,
      },
    );

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
      totals,
      rows: rows.map((r) => {
        const row = this.serializeList(r, this.inTransitOf(inTransit, r));
        return withBins ? { ...row, bins: this.binRows(r as InvDetail) } : row;
      }),
    };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const inv = await this.prisma.inventoryManagement.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !inv ||
      (scope.role !== 'admin' && inv.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Inventory ${id} not found`);
    }
    const inTransit = await this.outboundInTransit([inv]);
    return this.serializeDetail(inv, this.inTransitOf(inTransit, inv));
  }

  // ---------- manual bin adjustment ----------

  // Redistribute the available quantity across bins. The sum of the submitted
  // avail_qty must exactly equal the current total available (only availQty is
  // touched; reserved/in-transit/issue quantities are left untouched). Atomic.
  async adjustBins(id: string, dto: AdjustBinsDto, scope: WarehouseScope) {
    const inv = await this.prisma.inventoryManagement.findUnique({
      where: { id },
      include: { binStocks: { include: { bin: { select: { binLabel: true } } } } },
    });
    if (
      !inv ||
      (scope.role !== 'admin' && inv.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Inventory ${id} not found`);
    }

    const lines = dto.bins ?? [];

    // --- validate: no duplicate bins (treat null as a single "no bin" key) ---
    const seen = new Set<string>();
    for (const l of lines) {
      const key = l.bin_id ?? '__null__';
      if (seen.has(key)) {
        throw new BadRequestException('Duplicate bin in the submitted list');
      }
      seen.add(key);
      if (!(l.avail_qty >= 0)) {
        throw new BadRequestException('Quantity must not be negative');
      }
    }

    // Frozen (KIT) bins are out of this editor entirely: their stock is neither
    // redistributed nor counted, so a stale client cannot zero it out.
    const frozenBinIds = new Set(
      inv.binStocks
        .filter((bs) => isFrozenBinLabel(bs.bin?.binLabel))
        .map((bs) => bs.binId)
        .filter((b): b is string => !!b),
    );
    for (const l of lines) {
      if (l.bin_id && frozenBinIds.has(l.bin_id)) {
        throw new BadRequestException(
          'A frozen (KIT) bin cannot be edited here — its stock is reported as Freeze Qty',
        );
      }
    }

    // --- validate: submitted bins exist and belong to this warehouse ---
    const binIds = lines
      .map((l) => l.bin_id)
      .filter((b): b is string => !!b);
    if (binIds.length > 0) {
      const bins = await this.prisma.bin.findMany({
        where: { id: { in: binIds } },
        select: { id: true, warehouseId: true },
      });
      const found = new Map(bins.map((b) => [b.id, b.warehouseId]));
      for (const b of binIds) {
        const wh = found.get(b);
        if (wh === undefined) {
          throw new BadRequestException(`Bin ${b} not found`);
        }
        if (inv.warehouseId && wh !== inv.warehouseId) {
          throw new BadRequestException(
            'Bin does not belong to this warehouse',
          );
        }
      }
    }

    // --- validate: total must match current available exactly ---
    // Frozen stock is excluded on both sides, matching what the page shows.
    const currentTotal = inv.binStocks
      .filter((bs) => !isFrozenBinLabel(bs.bin?.binLabel))
      .reduce((a, b) => a + b.availQty, 0);
    const newTotal = lines.reduce((a, l) => a + l.avail_qty, 0);
    if (Math.abs(newTotal - currentTotal) > 1e-9) {
      throw new BadRequestException(
        `Total bin quantity (${newTotal}) must equal total available (${currentTotal})`,
      );
    }

    // --- apply atomically: only availQty is modified ---
    const existingByBin = new Map(
      inv.binStocks.map((bs) => [bs.binId ?? '__null__', bs]),
    );
    // The manual editor sets availQty to an absolute value, so the ledger delta
    // is (new - old); every other bucket is left untouched.
    const manualSource = {
      module: 'manual' as const,
      id,
      // One id per save, so Transfer History can pair the bins it emptied
      // with the bins it filled.
      number: randomUUID(),
      note: 'Bin quantities edited manually',
      actorId: scope.userId ?? null,
    };
    const noChange = { reserved: 0, inTransit: 0, quality: 0, qtyIssue: 0 };

    await this.prisma.$transaction(async (tx) => {
      // Update / create the submitted bins.
      for (const l of lines) {
        const key = l.bin_id ?? '__null__';
        const existing = existingByBin.get(key);
        if (existing) {
          if (existing.availQty !== l.avail_qty) {
            const row = await tx.inventoryBinStock.update({
              where: { id: existing.id },
              data: { availQty: l.avail_qty },
            });
            await this.recordMovement(
              tx,
              id,
              l.bin_id ?? null,
              { ...noChange, avail: l.avail_qty - existing.availQty },
              {
                avail: row.availQty,
                reserved: row.reservedQty,
                inTransit: row.inTransitQty,
                quality: row.qualityIssue,
                qtyIssue: row.qtyIssue,
              },
              manualSource,
            );
          }
        } else {
          const row = await tx.inventoryBinStock.create({
            data: {
              inventoryId: id,
              binId: l.bin_id ?? null,
              availQty: l.avail_qty,
            },
          });
          await this.recordMovement(
            tx,
            id,
            l.bin_id ?? null,
            { ...noChange, avail: l.avail_qty },
            {
              avail: row.availQty,
              reserved: row.reservedQty,
              inTransit: row.inTransitQty,
              quality: row.qualityIssue,
              qtyIssue: row.qtyIssue,
            },
            manualSource,
          );
        }
      }
      // Zero out availQty on existing bins that were dropped from the list.
      // Frozen (KIT) bins are never part of the list, so they must be skipped
      // here or their stock would be wiped on every save.
      for (const [key, bs] of existingByBin) {
        if (isFrozenBinLabel(bs.bin?.binLabel)) continue;
        if (!seen.has(key) && bs.availQty !== 0) {
          const row = await tx.inventoryBinStock.update({
            where: { id: bs.id },
            data: { availQty: 0 },
          });
          await this.recordMovement(
            tx,
            id,
            bs.binId,
            { ...noChange, avail: -bs.availQty },
            {
              avail: row.availQty,
              reserved: row.reservedQty,
              inTransit: row.inTransitQty,
              quality: row.qualityIssue,
              qtyIssue: row.qtyIssue,
            },
            { ...manualSource, note: 'Bin removed from the manual list' },
          );
        }
      }
    });

    return this.findOne(id, scope);
  }

  /**
   * Transfer History: every manual bin re-allocation of this inventory, as
   * "from bin -> to bin, qty" rows. One save is one set of movements (grouped
   * by its batch number; older saves without one fall back to the second they
   * happened in). Within a save, the bins that lost stock are matched to the
   * bins that gained it in order, which yields the moves that save made.
   */
  /**
   * The SO / TO documents behind an inventory row's header Reserved Qty or In
   * Transit Qty.
   *
   * Reserved: stock is reserved when a picking is generated and released when
   * its delivery ships. Per picking line that leaves the picked qty (the
   * requested qty while the picking is still open), less what packing could
   * not pack and less what closed deliveries already took out.
   *
   * In Transit: the header figure comes from the ERP sync. The documents
   * behind it are the Transfer Orders shipped to this warehouse whose goods
   * have not been received yet (fulfilled − received).
   */
  async qtySources(id: string, type: string, scope: WarehouseScope) {
    if (type !== 'reserved' && type !== 'in-transit') {
      throw new BadRequestException('type must be reserved or in-transit');
    }
    const inv = await this.prisma.inventoryManagement.findUnique({
      where: { id },
      select: {
        warehouseId: true,
        materialId: true,
        materialCode: true,
        material: { select: { materialName: true } },
        warehouse: { select: { name: true } },
        binStocks: { select: { reservedQty: true } },
      },
    });
    if (!inv || (scope.role !== 'admin' && inv.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Inventory ${id} not found`);
    }
    const header = {
      material_code: inv.materialCode,
      material_name: inv.material?.materialName ?? null,
      warehouse_name: inv.warehouse?.name ?? null,
    };

    if (type === 'reserved') {
      const { rows, cancelledQty } = await this.reservedRows(
        {
          ...(inv.materialId ? { materialId: inv.materialId } : { materialCode: inv.materialCode }),
          picking: { warehouseId: inv.warehouseId },
        },
        false,
      );
      return {
        ...header,
        type,
        header_qty: inv.binStocks.reduce((s, b) => s + b.reservedQty, 0),
        documents_qty: rows.reduce((s, r) => s + r.qty, 0),
        cancelled_qty: cancelledQty,
        rows,
      };
    }

    const rows = await this.inTransitRows(
      {
        ...(inv.materialId ? { materialId: inv.materialId } : {}),
        transferOrder: { warehouseId: inv.warehouseId },
      },
      false,
    );
    const documentsQty = rows.reduce((s, r) => s + r.qty, 0);
    return {
      ...header,
      type,
      // The header figure is this same sum (see outboundInTransit).
      header_qty: documentsQty,
      documents_qty: documentsQty,
      rows,
    };
  }

  /**
   * Reserved / In Transit documents across every inventory row in scope — the
   * page behind the Inventory List's total cards. Filters (values OR-ed, fields
   * AND-ed) apply per document + material; the result is one row per document
   * with its matching materials under `lines`, paged by document.
   */
  async qtySourcesAll(
    type: string,
    query: { page?: number | string; limit?: number | string; filters?: string },
    scope: WarehouseScope,
  ) {
    if (type !== 'reserved' && type !== 'in-transit') {
      throw new BadRequestException('type must be reserved or in-transit');
    }
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    let filters: { field: string; values: string[] }[] = [];
    if (query.filters) {
      try {
        const parsed: unknown = JSON.parse(query.filters);
        if (Array.isArray(parsed)) filters = parsed as typeof filters;
      } catch {
        throw new BadRequestException('filters must be a JSON array of {field, values}');
      }
    }
    // Admin may narrow to the header's site; everyone else sees their warehouse.
    const warehouseId = scope.role === 'admin' ? scope.warehouseId : (scope.warehouseId ?? '__no_warehouse__');

    let all: DocRow[];
    let cancelledQty = 0;
    if (type === 'reserved') {
      const res = await this.reservedRows(warehouseId ? { picking: { warehouseId } } : {}, true);
      all = res.rows;
      cancelledQty = res.cancelledQty;
    } else {
      all = await this.inTransitRows(warehouseId ? { transferOrder: { warehouseId } } : {}, true);
    }

    const has = (text: string | null | undefined, v: string) => !!text && text.toLowerCase().includes(v);
    const codes = (refs: { code: string }[] | undefined, v: string) => (refs ?? []).some((d) => has(d.code, v));
    const match: Partial<Record<string, (r: DocRow, v: string) => boolean>> = {
      material_code: (r, v) => has(r.material_code, v),
      material_name: (r, v) => has(r.material_name, v),
      warehouse: (r, v) => has(r.warehouse_name, v),
      tran_id: (r, v) => has(r.doc_number, v),
      erp_doc_id: (r, v) => has(r.erp_doc_id, v),
      party: (r, v) => has(r.party, v),
      picking_id: (r, v) => codes(r.pickings, v),
      packing_id: (r, v) => codes(r.packings, v),
      sd_id: (r, v) => codes(r.sds, v),
      // Exact: SO or TO (a dropdown, not free text).
      doc_type: (r, v) => r.doc_type.toLowerCase() === v,
    };
    const active = filters.flatMap((f) => {
      const test = match[f.field];
      const values = (f.values ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
      return test && values.length ? [{ test, values }] : [];
    });
    const lines = all.filter((r) => active.every((f) => f.values.some((v) => f.test(r, v))));

    // One row per document; its matching materials go in `lines` (the accordion).
    const docs = new Map<string, DocRow & { lines: DocRow[] }>();
    const addRefs = (into: { code: string; id: string }[] | undefined, from: { code: string; id: string }[] | undefined) => {
      for (const d of from ?? []) if (into && !into.some((x) => x.id === d.id)) into.push(d);
    };
    for (const l of lines) {
      const key = `${l.doc_type}|${l.doc_id}`;
      let doc = docs.get(key);
      if (!doc) {
        doc = {
          ...l,
          references: [],
          packing_ids: [],
          pickings: [],
          packings: [],
          sds: [],
          qty: 0,
          qty_picking: 0,
          qty_packing: null,
          packing_diff: 0,
          qty_delivered: 0,
          qty_received: 0,
          lines: [],
        };
        docs.set(key, doc);
      }
      doc.lines.push(l);
      doc.qty += l.qty;
      doc.qty_picking = (doc.qty_picking ?? 0) + (l.qty_picking ?? 0);
      if (l.qty_packing != null) doc.qty_packing = (doc.qty_packing ?? 0) + l.qty_packing;
      doc.packing_diff = (doc.packing_diff ?? 0) + (l.packing_diff ?? 0);
      doc.qty_delivered = (doc.qty_delivered ?? 0) + (l.qty_delivered ?? 0);
      doc.qty_received = (doc.qty_received ?? 0) + (l.qty_received ?? 0);
      addRefs(doc.pickings, l.pickings);
      addRefs(doc.packings, l.packings);
      addRefs(doc.sds, l.sds);
    }
    const documents = [...docs.values()].sort((a, b) => b.qty - a.qty);

    const sum = (pick: (r: DocRow) => number | null | undefined) => lines.reduce((t, r) => t + (pick(r) ?? 0), 0);
    return {
      type,
      total_data: documents.length,
      total_page: Math.ceil(documents.length / limit) || 0,
      attributes: { page, limit, filters },
      totals: {
        qty: sum((r) => r.qty),
        qty_picking: sum((r) => r.qty_picking),
        qty_packing: sum((r) => r.qty_packing),
        packing_diff: sum((r) => r.packing_diff),
        qty_delivered: sum((r) => r.qty_delivered),
        qty_received: sum((r) => r.qty_received),
        documents: documents.length,
        materials: lines.length,
      },
      cancelled_qty: cancelledQty,
      rows: documents.slice((page - 1) * limit, page * limit),
    };
  }

  /**
   * Reserved stock per SO / TO: stock is reserved when a picking is generated
   * and released when its delivery ships. Per picking line that leaves the
   * picked qty (the requested qty while the picking is still open), less what
   * packing could not pack and less what closed deliveries already took out.
   * Cancelled documents are left out (their qty is reported separately).
   * `perMaterial` keeps one row per document + material + warehouse.
   */
  private async reservedRows(where: Prisma.PickingItemWhereInput, perMaterial: boolean) {
    const lines = await this.prisma.pickingItem.findMany({
      where,
      select: {
        requestQty: true,
        actualQty: true,
        materialId: true,
        materialCode: true,
        materialName: true,
        picking: {
          select: {
            id: true,
            pickingCode: true,
            status: true,
            warehouseId: true,
            warehouse: { select: { name: true } },
            salesOrder: { select: { id: true, tranId: true, oracleId: true, statusName: true, customerName: true } },
            transferOrder: { select: { id: true, tranId: true, oracleId: true, statusName: true, toLocationName: true } },
          },
        },
        packingItems: {
          select: {
            actualQty: true,
            qtyIssue: true,
            qualityIssue: true,
            packing: { select: { id: true, packingCode: true, status: true } },
          },
        },
        deliveryItems: { where: { delivery: { status: 'Closed' } }, select: { qty: true } },
      },
    });
    const docs = new Map<string, DocRow>();
    let cancelledQty = 0;
    for (const l of lines) {
      const pk = l.picking;
      const held = pk.status === 'Closed' ? l.actualQty : l.requestQty;
      // Only a closed packing has settled what was (not) packed.
      const packed = l.packingItems.filter((p) => p.packing.status === 'Closed');
      const notPacked = packed.reduce((s, p) => s + p.qtyIssue + p.qualityIssue, 0);
      const shipped = l.deliveryItems.reduce((s, d) => s + d.qty, 0);
      const qty = Math.max(0, held - notPacked - shipped);
      if (qty <= 0) continue;
      const so = pk.salesOrder;
      const to = pk.transferOrder;
      const doc = so ?? to;
      if (!doc) continue;
      if (isCancelled(doc.statusName)) {
        cancelledQty += qty;
        continue;
      }
      const key = `${so ? 'SO' : 'TO'}|${doc.id}` + (perMaterial ? `|${l.materialId ?? l.materialCode}|${pk.warehouseId}` : '');
      const row =
        docs.get(key) ??
        ({
          doc_type: so ? 'SO' : 'TO',
          doc_id: doc.id,
          doc_number: doc.tranId,
          erp_doc_id: doc.oracleId,
          status: doc.statusName,
          party: so ? so.customerName : (to?.toLocationName ?? null),
          material_code: l.materialCode,
          material_name: l.materialName,
          warehouse_name: pk.warehouse?.name ?? null,
          references: [],
          packing_ids: [],
          pickings: [],
          packings: [],
          qty: 0,
          qty_picking: 0,
          qty_packing: null,
          packing_diff: 0,
        } satisfies DocRow);
      row.qty += qty;
      row.qty_picking = (row.qty_picking ?? 0) + held;
      row.packing_diff = (row.packing_diff ?? 0) + notPacked;
      if (packed.length) {
        row.qty_packing = (row.qty_packing ?? 0) + packed.reduce((s, p) => s + p.actualQty, 0);
      }
      for (const p of l.packingItems) {
        if (!row.packing_ids.includes(p.packing.packingCode)) {
          row.packing_ids.push(p.packing.packingCode);
          row.packings!.push({ id: p.packing.id, code: p.packing.packingCode });
        }
      }
      if (!row.references.includes(pk.pickingCode)) {
        row.references.push(pk.pickingCode);
        row.pickings!.push({ id: pk.id, code: pk.pickingCode });
      }
      docs.set(key, row);
    }
    return { rows: [...docs.values()].sort((a, b) => b.qty - a.qty), cancelledQty };
  }

  /**
   * In Transit per TO: what TO-out deliveries shipped (closed by Generate
   * Shipment) and the destination has not received yet. Cancelled TOs are left
   * out. `perMaterial` keeps one row per TO + material + origin warehouse.
   */
  private async inTransitRows(where: Prisma.TransferOrderItemWhereInput, perMaterial: boolean) {
    const lines = await this.prisma.transferOrderItem.findMany({
      where: { ...where, deliveryItems: { some: { delivery: { status: 'Closed' } } } },
      select: {
        received: true,
        materialId: true,
        itemName: true,
        transferOrder: {
          select: {
            id: true,
            tranId: true,
            oracleId: true,
            statusName: true,
            toLocationName: true,
            warehouseId: true,
            warehouse: { select: { name: true } },
          },
        },
        deliveryItems: {
          where: { delivery: { status: 'Closed' } },
          select: {
            qty: true,
            delivery: {
              select: {
                id: true,
                deliveryCode: true,
                sdoId: true,
                packing: { select: { id: true, packingCode: true } },
              },
            },
          },
        },
      },
    });
    const materialIds = [...new Set(lines.map((l) => l.materialId).filter((x): x is string => !!x))];
    const mats = materialIds.length
      ? await this.prisma.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, materialCode: true, materialName: true },
        })
      : [];
    const matById = new Map(mats.map((m) => [m.id, m]));

    const docs = new Map<string, DocRow>();
    for (const l of lines) {
      const shipped = l.deliveryItems.reduce((s, d) => s + d.qty, 0);
      const qty = Math.max(0, shipped - l.received);
      if (qty <= 0) continue;
      const to = l.transferOrder;
      if (isCancelled(to.statusName)) continue;
      const mat = l.materialId ? matById.get(l.materialId) : null;
      const key = to.id + (perMaterial ? `|${l.materialId ?? l.itemName}|${to.warehouseId}` : '');
      const row =
        docs.get(key) ??
        ({
          doc_type: 'TO',
          doc_id: to.id,
          doc_number: to.tranId,
          erp_doc_id: to.oracleId,
          status: to.statusName,
          party: to.toLocationName,
          material_code: mat?.materialCode ?? l.itemName,
          material_name: mat?.materialName ?? null,
          warehouse_name: to.warehouse?.name ?? null,
          references: [],
          packing_ids: [],
          sds: [],
          packings: [],
          qty: 0,
          qty_delivered: 0,
          qty_received: 0,
        } satisfies DocRow);
      row.qty += qty;
      row.qty_delivered = (row.qty_delivered ?? 0) + shipped;
      row.qty_received = (row.qty_received ?? 0) + l.received;
      for (const d of l.deliveryItems) {
        if (!row.references.includes(d.delivery.deliveryCode)) {
          row.references.push(d.delivery.deliveryCode);
          // Shown by its SD number; a delivery without one falls back to its code.
          row.sds!.push({ id: d.delivery.id, code: d.delivery.sdoId ?? d.delivery.deliveryCode });
        }
        const pack = d.delivery.packing;
        if (pack && !row.packing_ids.includes(pack.packingCode)) {
          row.packing_ids.push(pack.packingCode);
          row.packings!.push({ id: pack.id, code: pack.packingCode });
        }
      }
      docs.set(key, row);
    }
    return [...docs.values()].sort((a, b) => b.qty - a.qty);
  }

  async transferHistory(id: string, scope: WarehouseScope) {
    const inv = await this.prisma.inventoryManagement.findUnique({
      where: { id },
      select: { warehouseId: true },
    });
    if (!inv || (scope.role !== 'admin' && inv.warehouseId !== scope.warehouseId)) {
      throw new NotFoundException(`Inventory ${id} not found`);
    }

    const moves = await this.prisma.stockMovement.findMany({
      where: { inventoryId: id, sourceModule: 'manual', deltaAvail: { not: 0 } },
      include: {
        bin: { select: { binLabel: true, binCode: true } },
        actor: { select: { name: true, username: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    type Move = (typeof moves)[number];
    const groups = new Map<string, Move[]>();
    for (const mv of moves) {
      const key = mv.sourceNumber ?? mv.createdAt.toISOString().slice(0, 19);
      const g = groups.get(key);
      if (g) g.push(mv);
      else groups.set(key, [mv]);
    }

    const binOf = (mv: Move) => ({
      bin_id: mv.binId,
      bin_code: mv.bin?.binCode ?? null,
      bin_label: mv.bin?.binLabel ?? null,
    });

    const rows: {
      id: string;
      created_at: Date;
      from_bin: ReturnType<typeof binOf>;
      to_bin: ReturnType<typeof binOf>;
      qty: number;
      adjusted_by: string | null;
    }[] = [];
    for (const [key, g] of groups) {
      const out = g
        .filter((m) => m.deltaAvail < 0)
        .map((m) => ({ m, left: -m.deltaAvail }));
      const into = g
        .filter((m) => m.deltaAvail > 0)
        .map((m) => ({ m, left: m.deltaAvail }));
      let i = 0;
      let j = 0;
      while (i < out.length && j < into.length) {
        const qty = Math.min(out[i].left, into[j].left);
        if (qty > 1e-9) {
          rows.push({
            id: `${key}-${rows.length}`,
            created_at: into[j].m.createdAt,
            from_bin: binOf(out[i].m),
            to_bin: binOf(into[j].m),
            qty,
            adjusted_by:
              into[j].m.actor?.name ?? into[j].m.actor?.username ?? null,
          });
        }
        out[i].left -= qty;
        into[j].left -= qty;
        if (out[i].left <= 1e-9) i++;
        if (into[j].left <= 1e-9) j++;
      }
    }

    return rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  // ---------- generation (called when a GR is received) ----------

  async generateFromGoodsReceive(goodsReceiveId: string) {
    const gr = await this.prisma.goodsReceive.findUnique({
      where: { id: goodsReceiveId },
    });
    if (!gr) return;

    const mrn = await loadPibMrn(this.prisma, gr);
    if (!mrn) return;

    let created = 0;
    for (const item of mrn.items) {
      if (!(item.qtyActual > 0)) continue;

      // Idempotent: skip items already taken into inventory.
      if (item.inventoriedAt) continue;

      // Material: join mrn_item.item_id -> materials.erp_doc_id
      const material =
        item.itemId != null
          ? await this.prisma.material.findUnique({
              where: { erpDocId: String(item.itemId) },
            })
          : null;
      const materialCode: string =
        material?.materialCode ?? item.itemName ?? `ITEM-${item.itemId}`;

      // Find-or-create the inventory row for (materialCode, warehouse).
      let inv = await this.prisma.inventoryManagement.findFirst({
        where: { materialCode, warehouseId: gr.warehouseId },
      });
      if (!inv) {
        inv = await this.prisma.inventoryManagement.create({
          data: {
            materialCode,
            materialId: material?.id ?? null,
            warehouseId: gr.warehouseId,
          },
        });
      } else if (!inv.materialId && material) {
        inv = await this.prisma.inventoryManagement.update({
          where: { id: inv.id },
          data: { materialId: material.id },
        });
      }

      const gap =
        item.qtyActual < item.qtyExpected
          ? item.qtyExpected - item.qtyActual
          : 0;

      // Per-bin stock: received qty lands in the receive bin, grouped per
      // (inventory, bin). Mark the item inventoried in the same transaction.
      const invId = inv.id;
      await this.prisma.$transaction(async (tx) => {
        await this.adjustBinStock(
          invId,
          item.binId ?? null,
          { avail: item.qtyActual, qtyIssue: gap },
          {
            module: 'goods-receive',
            id: goodsReceiveId,
            number: gr.grNumber,
            note: 'Inventory generated from Goods Receive',
          },
          tx,
        );
        await tx.mrnItem.update({
          where: { id: item.id },
          data: { inventoriedAt: new Date() },
        });
      });
      created++;
    }
    this.logger.log(
      `Inventory generated for GR ${goodsReceiveId}: ${created} batch(es)`,
    );
    return { created };
  }

  // Increment a bin's stock by the given deltas (negative = decrease),
  // creating the (inventory, bin) row if needed. Accepts a tx client.
  //
  // Every caller must say which document caused the movement: this is the single
  // choke point for GR, putaway, picking, packing and delivery, so it is also
  // where the stock ledger is written (FR-IA-14 rule 4 / NFR-IA-L-05).
  async adjustBinStock(
    inventoryId: string,
    binId: string | null,
    d: StockDelta,
    source: StockMovementSource,
    client?: Prisma.TransactionClient,
  ) {
    const c = client ?? this.prisma;
    const existing = await c.inventoryBinStock.findFirst({
      where: { inventoryId, binId },
    });

    const delta = {
      avail: d.avail ?? 0,
      reserved: d.reserved ?? 0,
      inTransit: d.inTransit ?? 0,
      quality: d.quality ?? 0,
      qtyIssue: d.qtyIssue ?? 0,
    };

    let after: {
      avail: number;
      reserved: number;
      inTransit: number;
      quality: number;
      qtyIssue: number;
    };

    if (existing) {
      const row = await c.inventoryBinStock.update({
        where: { id: existing.id },
        data: {
          availQty: { increment: delta.avail },
          reservedQty: { increment: delta.reserved },
          inTransitQty: { increment: delta.inTransit },
          qualityIssue: { increment: delta.quality },
          qtyIssue: { increment: delta.qtyIssue },
        },
      });
      after = {
        avail: row.availQty,
        reserved: row.reservedQty,
        inTransit: row.inTransitQty,
        quality: row.qualityIssue,
        qtyIssue: row.qtyIssue,
      };
    } else {
      const row = await c.inventoryBinStock.create({
        data: {
          inventoryId,
          binId,
          availQty: delta.avail,
          reservedQty: delta.reserved,
          inTransitQty: delta.inTransit,
          qualityIssue: delta.quality,
          qtyIssue: delta.qtyIssue,
        },
      });
      after = {
        avail: row.availQty,
        reserved: row.reservedQty,
        inTransit: row.inTransitQty,
        quality: row.qualityIssue,
        qtyIssue: row.qtyIssue,
      };
    }

    await this.recordMovement(c, inventoryId, binId, delta, after, source);
  }

  /**
   * Append one ledger row. A movement that changes nothing is not recorded, and
   * a ledger failure never rolls back the stock change it describes.
   */
  async recordMovement(
    c: Prisma.TransactionClient | PrismaService,
    inventoryId: string,
    binId: string | null,
    delta: {
      avail: number;
      reserved: number;
      inTransit: number;
      quality: number;
      qtyIssue: number;
    },
    after: {
      avail: number;
      reserved: number;
      inTransit: number;
      quality: number;
      qtyIssue: number;
    },
    source: StockMovementSource,
  ) {
    const moved =
      delta.avail || delta.reserved || delta.inTransit || delta.quality || delta.qtyIssue;
    if (!moved) return;

    try {
      const inv = await c.inventoryManagement.findUnique({
        where: { id: inventoryId },
        select: { warehouseId: true, materialId: true, materialCode: true },
      });
      await c.stockMovement.create({
        data: {
          inventoryId,
          binId,
          warehouseId: inv?.warehouseId ?? null,
          materialId: inv?.materialId ?? null,
          materialCode: inv?.materialCode ?? null,
          deltaAvail: delta.avail,
          deltaReserved: delta.reserved,
          deltaInTransit: delta.inTransit,
          deltaQuality: delta.quality,
          deltaQtyIssue: delta.qtyIssue,
          availAfter: after.avail,
          reservedAfter: after.reserved,
          inTransitAfter: after.inTransit,
          qualityAfter: after.quality,
          qtyIssueAfter: after.qtyIssue,
          sourceModule: source.module,
          sourceId: source.id ?? null,
          sourceNumber: source.number ?? null,
          note: source.note ?? null,
          actorId: source.actorId ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Could not write the stock ledger for inventory ${inventoryId}: ${(e as Error).message}`,
      );
    }
  }

  // ---------- serializers ----------

  /**
   * Aggregate bin stocks. avail_qty is the plain sum across every bin, KIT bins
   * included — that is what a bin physically holds. freeze_qty reports how much
   * of that sum sits in a frozen (KIT) bin, so the header can show the usable
   * remainder as avail_qty - freeze_qty.
   */
  private sumBatches(
    batches: {
      reservedQty: number;
      availQty: number;
      inTransitQty: number;
      qualityIssue: number;
      qtyIssue: number;
      bin?: { binLabel: string | null } | null;
    }[],
  ) {
    const s = batches.reduce(
      (a, b) => {
        const frozen = isFrozenBinLabel(b.bin?.binLabel);
        return {
          reserved_qty: a.reserved_qty + b.reservedQty,
          avail_qty: a.avail_qty + b.availQty,
          freeze_qty: a.freeze_qty + (frozen ? b.availQty : 0),
          in_transit_qty: a.in_transit_qty + b.inTransitQty,
          quality_issue: a.quality_issue + b.qualityIssue,
          qty_issue: a.qty_issue + b.qtyIssue,
        };
      },
      {
        reserved_qty: 0,
        avail_qty: 0,
        freeze_qty: 0,
        in_transit_qty: 0,
        quality_issue: 0,
        qty_issue: 0,
      },
    );
    return {
      ...s,
      // avail_qty already includes frozen stock, so on hand does not add it
      // again. on_hand = reserved + avail + quality_issue + qty_issue
      on_hand: s.reserved_qty + s.avail_qty + s.quality_issue + s.qty_issue,
    };
  }

  private materialFields(m: InvList | InvDetail) {
    return {
      material_name: m.material?.materialName ?? null,
      material_code: m.materialCode,
      material_type: m.material?.materialType?.materialTypeName ?? null,
      material_category:
        m.material?.materialCategory?.materialCategoryName ?? null,
      primary_uom: m.material?.primaryUom?.uomCode ?? null,
      secondary_uom: m.material?.secondaryUom?.uomCode ?? null,
      erp_doc_id: m.material?.erpDocId ?? null,
      warehouse_name: m.warehouse?.name ?? null,
    };
  }

  private oracleHeaderFields(m: InvList | InvDetail) {
    return {
      qty_committed: m.qtyCommitted,
      qty_on_order: m.qtyOnOrder,
      qty_back_order: m.qtyBackOrder,
      qty_in_transit: m.qtyInTransit,
    };
  }

  /**
   * Header view of the aggregate: avail_qty becomes the USABLE quantity
   * (bins minus frozen), with avail_in_bins kept so the page can show where
   * that number comes from.
   */
  private headerQuantities(batches: Parameters<typeof this.sumBatches>[0]) {
    const s = this.sumBatches(batches);
    return {
      ...s,
      avail_qty: s.avail_qty - s.freeze_qty,
      avail_in_bins: s.avail_qty,
    };
  }

  private serializeList(m: InvList, inTransit: number) {
    return {
      id: m.id,
      ...this.materialFields(m),
      ...this.oracleHeaderFields(m),
      ...this.headerQuantities(m.binStocks),
      // In Transit is tracked at header level (TO out shipped, not received).
      in_transit_qty: inTransit,
    };
  }

  /**
   * In Transit per origin warehouse + material: what Transfer Order deliveries
   * have shipped out of the warehouse (closed by Generate Shipment) and the
   * destination has not received yet. Keyed by `stockKey`.
   */
  private async outboundInTransit(rows: { warehouseId: string | null; materialId: string | null }[]) {
    const warehouseIds = [...new Set(rows.map((r) => r.warehouseId).filter((x): x is string => !!x))];
    const materialIds = [...new Set(rows.map((r) => r.materialId).filter((x): x is string => !!x))];
    const byKey = new Map<string, number>();
    if (!warehouseIds.length || !materialIds.length) return byKey;
    const lines = await this.prisma.transferOrderItem.findMany({
      where: {
        materialId: { in: materialIds },
        transferOrder: { warehouseId: { in: warehouseIds } },
        deliveryItems: { some: { delivery: { status: 'Closed' } } },
      },
      select: {
        materialId: true,
        received: true,
        transferOrder: { select: { warehouseId: true, statusName: true } },
        deliveryItems: { where: { delivery: { status: 'Closed' } }, select: { qty: true } },
      },
    });
    for (const l of lines) {
      if (!l.materialId || !l.transferOrder.warehouseId) continue;
      if (isCancelled(l.transferOrder.statusName)) continue;
      const qty = Math.max(0, l.deliveryItems.reduce((s, d) => s + d.qty, 0) - l.received);
      if (qty <= 0) continue;
      const key = `${l.transferOrder.warehouseId}|${l.materialId}`;
      byKey.set(key, (byKey.get(key) ?? 0) + qty);
    }
    return byKey;
  }

  private inTransitOf(
    byKey: Map<string, number>,
    m: { warehouseId: string | null; materialId: string | null },
  ) {
    return byKey.get(`${m.warehouseId}|${m.materialId}`) ?? 0;
  }

  /**
   * One row per bin location. Empty bins are hidden, except when that would
   * leave nothing at all: a material with no stock anywhere still reports its
   * Virtual bin, so it is never shown as having no bin.
   */
  private binRows(m: InvDetail) {
    const all = m.binStocks.map((bs) => {
      const { freeze_qty: _freeze, ...qty } = this.sumBatches([bs]);
      return {
        bin_id: bs.binId ?? null,
        bin_location: bs.bin?.binLabel ?? null,
        bin_code: bs.bin?.binCode ?? null,
        is_virtual: bs.bin?.isVirtual ?? false,
        is_frozen: isFrozenBinLabel(bs.bin?.binLabel),
        warehouse_name: m.warehouse?.name ?? null,
        ...qty,
      };
    });

    const holdsStock = (b: (typeof all)[number]) =>
      b.reserved_qty !== 0 ||
      b.avail_qty !== 0 ||
      b.in_transit_qty !== 0 ||
      b.quality_issue !== 0 ||
      b.qty_issue !== 0;

    const withStock = all.filter(holdsStock);
    const fallback = all.filter((b) => b.is_virtual).slice(0, 1);
    return (
      withStock.length ? withStock : fallback.length ? fallback : all.slice(0, 1)
    ).sort((a, b) => (a.bin_location ?? '').localeCompare(b.bin_location ?? ''));
  }

  private serializeDetail(m: InvDetail, inTransit: number) {
    const bins = this.binRows(m);

    return {
      id: m.id,
      warehouse_id: m.warehouseId ?? null,
      ...this.materialFields(m),
      ...this.oracleHeaderFields(m),
      ...this.headerQuantities(m.binStocks),
      // In Transit is tracked at header level (TO out shipped, not received).
      in_transit_qty: inTransit,
      bins,
    };
  }
}
