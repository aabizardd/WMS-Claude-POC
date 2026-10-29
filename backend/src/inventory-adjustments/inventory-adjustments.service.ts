import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  InventoryAdjustmentStatus,
  InventoryAdjustmentType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';
import { InventoryService } from '../inventory/inventory.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { isFrozenBinLabel, usableBinStockWhere } from '../common/frozen-bins';
import { parseDateRange } from '../common/date-range.util';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import {
  IA_TYPES,
  buildOracleMemo,
  ruleFor,
  stockEffect,
} from './ia-rules';
import type { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import type { ApproveInventoryAdjustmentDto } from './dto/approve-inventory-adjustment.dto';
import { scopeWhere, inScope } from '../common/warehouse-scope';

export interface WarehouseScope {
  userId: number;
  role: string;
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

// Static header values for the Oracle inventory adjustment (env-overridable).
const ADJ_CUSTOMFORM = Number(process.env.ORACLE_ADJ_CUSTOMFORM ?? 112);
const ADJ_SUBSIDIARY = Number(process.env.ORACLE_ADJ_SUBSIDIARY ?? 6);
const ADJ_ACCOUNT = Number(process.env.ORACLE_ADJ_ACCOUNT ?? 53);

const EPS = 1e-9;

interface OracleAdjustmentResponse {
  status?: string;
  success?: boolean;
  message?: string;
  inventory_adjustment_id?: number;
}

// POST /inventory/adjustments/get-status with { id: [<oracle ids>] }.
interface OracleAdjustmentStatusResponse {
  success?: boolean;
  total_records?: number;
  data?: {
    id?: string;
    custbody_me_approval_status?: string;
    custbody_me_approval_status_display?: string;
  }[];
}

const warehouseSelect = {
  select: { id: true, name: true, parentName: true, subsidiaryName: true },
} as const;

const itemInclude = {
  include: {
    bin: { select: { binCode: true, binLabel: true } },
    warehouse: warehouseSelect,
  },
  orderBy: { createdAt: 'asc' as const },
};

const listInclude = {
  warehouse: warehouseSelect,
  class: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: itemInclude,
  _count: { select: { discrepancies: true } },
} satisfies Prisma.InventoryAdjustmentInclude;

const detailInclude = {
  warehouse: warehouseSelect,
  class: { select: { id: true, name: true, oracleId: true } },
  department: { select: { id: true, name: true, oracleId: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  items: itemInclude,
  discrepancies: {
    include: {
      discrepancy: {
        select: {
          id: true,
          discrepancyId: true,
          discrepancyType: true,
          discrepancyFrom: true,
        },
      },
    },
  },
  events: {
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  integrationLogs: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.InventoryAdjustmentInclude;

type AdjList = Prisma.InventoryAdjustmentGetPayload<{
  include: typeof listInclude;
}>;
type AdjDetail = Prisma.InventoryAdjustmentGetPayload<{
  include: typeof detailInclude;
}>;

type AdjOrder = Prisma.InventoryAdjustmentOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => AdjOrder> = {
  adjustment_number: (d) => ({ adjustmentNumber: d }),
  adjustment_type: (d) => ({ adjustmentType: d }),
  status: (d) => ({ status: d }),
  oracle_approval_status: (d) => ({ oracleApprovalStatus: d }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  class: (d) => ({ class: { name: d } }),
  department: (d) => ({ department: { name: d } }),
  ownership: (d) => ({ warehouse: { subsidiaryName: d } }),
  created_by: (d) => ({ createdBy: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
};

// A line as accepted from the client, after server-side normalisation.
interface PreparedLine {
  materialId: string;
  materialCode: string | null;
  materialName: string | null;
  warehouseId: string;
  binId: string;
  binLabel: string | null;
  qtyAdjustment: number;
  qtyPassed: number;
  qtyNonPassed: number;
  avail: number;
  qtyIssue: number;
  qualityIssue: number;
}

/** Statuses whose reductions still hold stock that is not yet moved. */
const PENDING_STATUSES: InventoryAdjustmentStatus[] = [
  'WaitingApproval',
  'Approved',
  'WaitingOracleApproval',
];

/** List filter fields; every one but created_at is free text. */
export const IA_FILTER_FIELDS = [
  'material_code',
  'warehouse',
  'created_at',
  'bin',
  'material_name',
  'type',
  'created_by',
] as const;
export type IaFilterField = (typeof IA_FILTER_FIELDS)[number];

@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
    private inventory: InventoryService,
  ) {}

  // A document belongs to every warehouse one of its lines touches.
  private scopeWhere(scope: WarehouseScope): Prisma.InventoryAdjustmentWhereInput {
    if (!scope.warehouseIds) return {};
    const wh = { in: scope.warehouseIds };
    return { OR: [{ warehouseId: wh }, { items: { some: { warehouseId: wh } } }] };
  }

  /** Detail/action access: admins may open any document by id. */
  private canSee(
    a: { warehouseId: string; items: { warehouseId: string | null }[] },
    scope: WarehouseScope,
  ): boolean {
    if (scope.role === 'admin') return true;
    return inScope(scope, a.warehouseId) || a.items.some((it) => inScope(scope, it.warehouseId));
  }

  /**
   * Inventories the create form may draw from: the user's warehouses, or —
   * for an admin on "All" — every active warehouse of the allowed subsidiary,
   * so one document can span warehouses.
   */
  private inventoryScope(scope: WarehouseScope): Prisma.InventoryManagementWhereInput {
    if (scope.warehouseIds) return scopeWhere(scope);
    return { warehouse: { isInactive: false, subsidiaryId: subsidiarySingleFilter() } };
  }

  /**
   * Reductions already promised by documents that have not completed yet, per
   * material|bin. The create form shows them and a new reduction may not dip
   * into them.
   */
  private async pendingHolds(
    materialIds: string[],
    binIds: string[],
    excludeId?: string,
  ) {
    const rows = await this.prisma.inventoryAdjustmentItem.findMany({
      where: {
        materialId: { in: materialIds },
        binId: { in: binIds },
        qtyAdjustment: { lt: 0 },
        adjustment: {
          status: { in: PENDING_STATUSES },
          // Only the free-signed types draw on Available; the discrepancy types
          // clear Quantity/Quality Issue instead.
          adjustmentType: { in: IA_TYPES.filter((t) => ruleFor(t).qtyMode === 'free_signed') },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      },
      select: {
        materialId: true,
        binId: true,
        qtyAdjustment: true,
        adjustment: {
          select: {
            id: true,
            adjustmentNumber: true,
            status: true,
            createdBy: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const byKey = new Map<
      string,
      { qty: number; docs: { id: string; adjustment_number: string; status: string; qty: number; created_by: string | null }[] }
    >();
    for (const r of rows) {
      const key = `${r.materialId}|${r.binId}`;
      const entry = byKey.get(key) ?? { qty: 0, docs: [] };
      const qty = -r.qtyAdjustment;
      entry.qty += qty;
      entry.docs.push({
        id: r.adjustment.id,
        adjustment_number: r.adjustment.adjustmentNumber,
        status: r.adjustment.status,
        qty,
        created_by: r.adjustment.createdBy?.name ?? null,
      });
      byKey.set(key, entry);
    }
    return byKey;
  }

  private parseType(value: string | undefined): InventoryAdjustmentType {
    if (!value || !IA_TYPES.includes(value as InventoryAdjustmentType)) {
      throw new BadRequestException(
        `IA Type is required and must be one of: ${IA_TYPES.join(', ')}`,
      );
    }
    return value as InventoryAdjustmentType;
  }

  // FR-IA-05: the bin-stock predicate for the type's source bucket.
  private bucketWhere(
    type: InventoryAdjustmentType,
  ): Prisma.InventoryBinStockWhereInput {
    switch (ruleFor(type).filterBucket) {
      case 'qty_issue':
        return { qtyIssue: { gt: 0 } };
      case 'quality_issue':
        return { qualityIssue: { gt: 0 } };
      default:
        return {};
    }
  }

  // ---------- lookups (create form) ----------

  /**
   * FR-IA-05: materials that have at least one bin matching the type's bucket,
   * with the stock they hold in that bucket across the scope, searched by code
   * or name and paged for the card grid.
   */
  async materialOptions(
    type: string | undefined,
    scope: WarehouseScope,
    query: { search?: string; page?: number; limit?: number } = {},
  ) {
    const iaType = this.parseType(type);
    const bucket = ruleFor(iaType).filterBucket;
    const search = query.search?.trim();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 9));

    const stocks = await this.prisma.inventoryBinStock.findMany({
      where: {
        binId: { not: null },
        ...this.bucketWhere(iaType),
        ...usableBinStockWhere(),
        inventory: {
          ...this.inventoryScope(scope),
          materialId: { not: null },
          ...(search
            ? {
                OR: [
                  { materialCode: { contains: search, mode: 'insensitive' } },
                  { material: { materialName: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
      },
      select: {
        availQty: true,
        qtyIssue: true,
        qualityIssue: true,
        inventory: {
          select: {
            materialId: true,
            materialCode: true,
            material: {
              select: {
                materialName: true,
                primaryUom: { select: { uomCode: true, allowsDecimal: true } },
              },
            },
          },
        },
      },
    });

    const byMaterial = new Map<
      string,
      {
        material_id: string;
        material_code: string | null;
        material_name: string | null;
        uom_code: string | null;
        allows_decimal: boolean;
        in_stock: number;
        bin_count: number;
      }
    >();
    for (const st of stocks) {
      const inv = st.inventory;
      const id = inv.materialId!;
      const row = byMaterial.get(id) ?? {
        material_id: id,
        material_code: inv.materialCode,
        material_name: inv.material?.materialName ?? null,
        uom_code: inv.material?.primaryUom?.uomCode ?? null,
        allows_decimal: inv.material?.primaryUom?.allowsDecimal ?? true,
        in_stock: 0,
        bin_count: 0,
      };
      row.in_stock +=
        bucket === 'qty_issue' ? st.qtyIssue : bucket === 'quality_issue' ? st.qualityIssue : st.availQty;
      row.bin_count += 1;
      byMaterial.set(id, row);
    }

    const all = [...byMaterial.values()].sort((a, b) =>
      (a.material_code ?? '').localeCompare(b.material_code ?? ''),
    );
    return {
      total_page: Math.ceil(all.length / limit) || 0,
      total_data: all.length,
      rows: all.slice((page - 1) * limit, page * limit),
    };
  }

  /**
   * FR-IA-05: every bin of a material matching the type's bucket, across the
   * scope's warehouses, with what other pending documents already hold there.
   */
  async binOptions(
    materialId: string,
    type: string | undefined,
    scope: WarehouseScope,
  ) {
    const iaType = this.parseType(type);
    if (!materialId) return [];
    const rule = ruleFor(iaType);

    const stocks = await this.prisma.inventoryBinStock.findMany({
      where: {
        binId: { not: null },
        ...this.bucketWhere(iaType),
        ...usableBinStockWhere(),
        inventory: { ...this.inventoryScope(scope), materialId },
      },
      include: {
        bin: { select: { binCode: true, binLabel: true } },
        inventory: {
          select: {
            warehouse: { select: { id: true, name: true, parentName: true } },
          },
        },
      },
      orderBy: [{ inventory: { warehouse: { name: 'asc' } } }, { createdAt: 'asc' }],
    });
    const holds = await this.pendingHolds(
      [materialId],
      stocks.map((s) => s.binId!),
    );

    return stocks.map((bs) => {
      const hold = holds.get(`${materialId}|${bs.binId}`);
      return {
        bin_id: bs.binId,
        bin_code: bs.bin?.binCode ?? null,
        bin_label: bs.bin?.binLabel ?? null,
        warehouse_id: bs.inventory.warehouse?.id ?? null,
        warehouse_name: bs.inventory.warehouse?.name ?? null,
        warehouse_parent: bs.inventory.warehouse?.parentName ?? null,
        qty_available: bs.availQty,
        qty_issue: bs.qtyIssue,
        quality_issue: bs.qualityIssue,
        // Reductions on other pending documents; a new one may not use them.
        pending_qty: hold?.qty ?? 0,
        pending_docs: hold?.docs ?? [],
        // FR-IA-06/07: what the read-only qty will be for the Discrepancy types.
        suggested_qty_adjustment:
          rule.qtyMode === 'auto_negative'
            ? -(rule.filterBucket === 'qty_issue' ? bs.qtyIssue : bs.qualityIssue)
            : null,
      };
    });
  }

  /**
   * FR-IA-10 / UAC-IA-09 / UAC-IA-14: discrepancies offered as a reference,
   * restricted to the type's discrepancy kind and to the material AND bin
   * combinations already on the document.
   *
   * The link to a bin is indirect, because r_discrepancy_detail stores neither a
   * material id nor a bin:
   *   outbound -> Discrepancy.pickingId -> PickingItem(materialId, binId)
   *   inbound  -> DiscrepancyDetail.mrnItemId -> MrnItem(itemId, binId)
   * A discrepancy that carries no bin reference at all (an inbound one whose
   * details predate the MRN link) cannot be bin-filtered; it still matches on the
   * material name so it is not silently hidden, and is flagged bin_matched=false.
   */
  async discrepancyOptions(
    type: string | undefined,
    materialIds: string[],
    binIds: string[],
    scope: WarehouseScope,
  ) {
    const iaType = this.parseType(type);
    const kind = ruleFor(iaType).discrepancyList;
    if (!kind) return [];
    if (!materialIds.length) return [];

    const materials = await this.prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { materialName: true, materialCode: true, erpDocId: true },
    });
    const names = [
      ...new Set(
        materials.flatMap((m) => [m.materialName, m.materialCode]).filter(Boolean),
      ),
    ] as string[];
    if (!names.length) return [];
    const erpIds = materials
      .map((m) => Number(m.erpDocId))
      .filter((n) => Number.isFinite(n));

    // Bin-aware matches, only when the document already names some bins.
    let pickingIds: string[] = [];
    let mrnItemIds: string[] = [];
    if (binIds.length) {
      const [pickingItems, mrnItems] = await Promise.all([
        this.prisma.pickingItem.findMany({
          where: { materialId: { in: materialIds }, binId: { in: binIds } },
          select: { pickingId: true },
        }),
        erpIds.length
          ? this.prisma.mrnItem.findMany({
              where: { itemId: { in: erpIds }, binId: { in: binIds } },
              select: { id: true },
            })
          : Promise.resolve([] as { id: string }[]),
      ]);
      pickingIds = [...new Set(pickingItems.map((p) => p.pickingId))];
      mrnItemIds = mrnItems.map((m) => m.id);
    }

    const or: Prisma.DiscrepancyWhereInput[] = [];
    if (pickingIds.length) or.push({ pickingId: { in: pickingIds } });
    if (mrnItemIds.length) {
      or.push({ details: { some: { mrnItemId: { in: mrnItemIds } } } });
    }
    // Fallback for documents with no bin trace of their own.
    or.push({
      pickingId: null,
      details: { some: { itemName: { in: names }, mrnItemId: null } },
    });

    const rows = await this.prisma.discrepancy.findMany({
      where: {
        ...scopeWhere(scope),
        discrepancyType: kind,
        OR: or,
      },
      select: {
        id: true,
        discrepancyId: true,
        discrepancyType: true,
        discrepancyFrom: true,
        pickingId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const binMatched = new Set(pickingIds);
    return rows.map((d) => ({
      id: d.id,
      discrepancy_id: d.discrepancyId,
      type: d.discrepancyType,
      from: d.discrepancyFrom,
      // false = matched on the material only, because this discrepancy has no
      // bin reference to check against.
      bin_matched: d.pickingId != null && binMatched.has(d.pickingId),
      created_at: d.createdAt,
    }));
  }

  // ---------- line preparation & validation (FR-IA-06..09, FR-IA-11) ----------

  private async prepareLines(
    type: InventoryAdjustmentType,
    scope: WarehouseScope,
    items: {
      material_id: string;
      bin_id: string;
      qty_adjustment?: number;
      qty_passed?: number;
      qty_non_passed?: number;
    }[],
  ): Promise<PreparedLine[]> {
    if (!items?.length) {
      throw new BadRequestException('At least one material/bin line is required');
    }
    const rule = ruleFor(type);
    const seen = new Set<string>();
    const prepared: PreparedLine[] = [];

    // NFR-IA-T-02: a document may carry hundreds of lines, so everything the
    // loop needs is fetched in two queries up front rather than two per line.
    const materialIds = [...new Set(items.map((i) => i.material_id))];
    const binIds = [...new Set(items.map((i) => i.bin_id))];

    // A bin belongs to one warehouse, so material|bin finds one stock row in
    // whichever warehouse of the scope holds it.
    const stocks = await this.prisma.inventoryBinStock.findMany({
      where: {
        binId: { in: binIds },
        inventory: { ...this.inventoryScope(scope), materialId: { in: materialIds } },
      },
      include: {
        bin: { select: { binLabel: true } },
        inventory: {
          select: {
            materialId: true,
            materialCode: true,
            warehouseId: true,
            material: {
              select: {
                materialName: true,
                primaryUom: { select: { allowsDecimal: true } },
              },
            },
          },
        },
      },
    });
    const stockByKey = new Map(
      stocks.map((st) => [`${st.inventory.materialId}|${st.binId}`, st]),
    );
    const holds = await this.pendingHolds(materialIds, binIds);

    for (const line of items) {
      const key = `${line.material_id}|${line.bin_id}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'The same material and bin appears more than once in this document',
        );
      }
      seen.add(key);

      const stock = stockByKey.get(key);
      if (!stock) {
        throw new BadRequestException(
          'Selected bin does not hold this material in a warehouse you can adjust',
        );
      }
      const inv = stock.inventory;
      if (!inv.warehouseId) {
        throw new BadRequestException(
          `${inv.materialCode ?? line.material_id}: this stock row has no warehouse`,
        );
      }
      const warehouseId = inv.warehouseId;

      const label = `${inv.materialCode ?? line.material_id} @ ${
        stock.bin?.binLabel ?? line.bin_id
      }`;

      // A bin the form may not offer may not be saved through a hand-made
      // request either.
      if (isFrozenBinLabel(stock.bin?.binLabel)) {
        throw new BadRequestException(
          `${label}: this bin holds frozen (KIT) stock and cannot be adjusted`,
        );
      }
      const allowsDecimal = inv.material?.primaryUom?.allowsDecimal ?? true;

      let qtyAdjustment = 0;
      let qtyPassed = 0;
      let qtyNonPassed = 0;

      if (rule.qtyMode === 'auto_negative') {
        // FR-IA-06/07: the client's value is ignored; the whole bucket is taken.
        const bucket =
          rule.filterBucket === 'qty_issue' ? stock.qtyIssue : stock.qualityIssue;
        if (!(bucket > 0)) {
          throw new BadRequestException(
            `${label}: this bin no longer has a ${
              rule.filterBucket === 'qty_issue' ? 'Quantity' : 'Quality'
            } Issue to adjust`,
          );
        }
        qtyAdjustment = -bucket;
      } else if (rule.qtyMode === 'passed_non_passed') {
        qtyPassed = this.num(line.qty_passed);
        qtyNonPassed = this.num(line.qty_non_passed);
        if (qtyPassed < 0 || qtyNonPassed < 0) {
          throw new BadRequestException(
            `${label}: Qty Passed and Qty Non-Passed must be positive`,
          );
        }
        const total = qtyPassed + qtyNonPassed;
        // FR-IA-08 rule 4.
        if (!(total > 0)) {
          throw new BadRequestException(
            `${label}: enter Qty Passed and/or Qty Non-Passed (total must be greater than 0)`,
          );
        }
        // FR-IA-08 rule 3 — against Quality Issue, not against available.
        if (total > stock.qualityIssue + EPS) {
          throw new BadRequestException(
            `${label}: Qty Passed + Qty Non-Passed (${total}) exceeds Quality Issue (${stock.qualityIssue})`,
          );
        }
        this.assertDecimals(label, allowsDecimal, qtyPassed, qtyNonPassed);
      } else {
        qtyAdjustment = this.num(line.qty_adjustment);
        // FR-IA-09 rule 4.
        if (Math.abs(qtyAdjustment) < EPS) {
          throw new BadRequestException(`${label}: Qty Adjustment cannot be 0`);
        }
        // FR-IA-09 rule 3, net of what other pending documents already hold.
        const held = holds.get(key)?.qty ?? 0;
        const usable = stock.availQty - held;
        if (qtyAdjustment < 0 && usable + qtyAdjustment < -EPS) {
          throw new BadRequestException(
            held > EPS
              ? `${label}: a negative adjustment of ${qtyAdjustment} exceeds the available qty (${Math.max(0, usable)} of ${stock.availQty}; ${held} held by pending documents)`
              : `${label}: a negative adjustment of ${qtyAdjustment} exceeds the available qty (${stock.availQty})`,
          );
        }
        this.assertDecimals(label, allowsDecimal, qtyAdjustment);
      }

      prepared.push({
        materialId: line.material_id,
        materialCode: inv.materialCode,
        materialName: inv.material?.materialName ?? null,
        warehouseId,
        binId: line.bin_id,
        binLabel: stock.bin?.binLabel ?? null,
        qtyAdjustment,
        qtyPassed,
        qtyNonPassed,
        avail: stock.availQty,
        qtyIssue: stock.qtyIssue,
        qualityIssue: stock.qualityIssue,
      });
    }

    return prepared;
  }

  private num(v: unknown): number {
    const n = Number(v);
    // FR-IA-11 rule 3: letters and symbols are rejected rather than coerced to 0.
    if (!Number.isFinite(n)) {
      throw new BadRequestException('Qty must be a number');
    }
    return n;
  }

  // FR-IA-11 rule 4.
  private assertDecimals(label: string, allows: boolean, ...values: number[]) {
    if (allows) return;
    for (const v of values) {
      if (Math.abs(v - Math.round(v)) > EPS) {
        throw new BadRequestException(
          `${label}: the unit of measure does not allow decimal quantities`,
        );
      }
    }
  }

  // FR-IA-10: validate attached discrepancy references.
  private async validateDiscrepancies(
    type: InventoryAdjustmentType,
    ids: string[],
    scope: WarehouseScope,
  ): Promise<string[]> {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return [];

    const kind = ruleFor(type).discrepancyList;
    if (!kind) {
      throw new BadRequestException(
        'Discrepancy references can only be attached to Discrepancy Quantity or Discrepancy Quality documents',
      );
    }

    const found = await this.prisma.discrepancy.findMany({
      where: { id: { in: unique } },
      select: { id: true, discrepancyType: true, warehouseId: true },
    });
    const byId = new Map(found.map((d) => [d.id, d]));
    for (const id of unique) {
      const d = byId.get(id);
      if (!d) throw new BadRequestException(`Discrepancy ${id} not found`);
      if (d.discrepancyType !== kind) {
        throw new BadRequestException(
          `Discrepancy must be of type "${kind}" for this adjustment type`,
        );
      }
      if (scope.role !== 'admin' && !inScope(scope, d.warehouseId)) {
        throw new BadRequestException(`Discrepancy ${id} not found`);
      }
    }
    return unique;
  }

  // ---------- audit trail (FR-IA-15) ----------

  private event(
    tx: Prisma.TransactionClient | PrismaService,
    adjustmentId: string,
    action: string,
    opts: {
      from?: InventoryAdjustmentStatus | null;
      to?: InventoryAdjustmentStatus | null;
      actorId?: number | null;
      message?: string | null;
    } = {},
  ) {
    return tx.inventoryAdjustmentEvent.create({
      data: {
        adjustmentId,
        action,
        fromStatus: opts.from ?? null,
        toStatus: opts.to ?? null,
        actorId: opts.actorId ?? null,
        message: opts.message ?? null,
      },
    });
  }

  // ---------- integration log (FR-IA-13 rule 8, FR-IA-16 rule 6) ----------

  /**
   * Record one Oracle call verbatim. Logging must never be the reason an
   * adjustment fails, so a write error here is swallowed and only warned about.
   */
  private async logIntegration(entry: {
    adjustmentId: string;
    operation: 'post' | 'status_check';
    endpoint: string;
    request: unknown;
    response?: unknown;
    httpStatus?: number | null;
    ok: boolean;
    error?: string | null;
    durationMs: number;
  }) {
    try {
      await this.prisma.inventoryAdjustmentIntegrationLog.create({
        data: {
          adjustmentId: entry.adjustmentId,
          operation: entry.operation,
          endpoint: entry.endpoint,
          request: (entry.request ?? {}) as Prisma.InputJsonValue,
          response: (entry.response ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          httpStatus: entry.httpStatus ?? null,
          ok: entry.ok,
          error: entry.error?.slice(0, 2000) ?? null,
          durationMs: entry.durationMs,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Could not write the integration log for ${entry.adjustmentId}: ${(e as Error).message}`,
      );
    }
  }

  // ---------- create (FR-IA-11 / FR-IA-12) ----------

  /**
   * There is no Draft stage: the confirmation dialog on the create form is the
   * submission, so a document is born in Waiting Approval and is read-only from
   * that moment on.
   */
  async create(dto: CreateInventoryAdjustmentDto, scope: WarehouseScope) {
    const type = this.parseType(dto.adjustment_type);

    const [klass, department] = await Promise.all([
      this.prisma.class.findUnique({ where: { id: dto.class_id }, select: { id: true } }),
      this.prisma.department.findUnique({
        where: { id: dto.department_id },
        select: { id: true },
      }),
    ]);
    if (!klass) throw new BadRequestException('Selected class does not exist');
    if (!department) throw new BadRequestException('Selected department does not exist');

    const prepared = await this.prepareLines(type, scope, dto.items);
    // The header carries the first line's warehouse; each line keeps its own.
    const warehouseId = prepared[0].warehouseId;
    const discrepancyIds = await this.validateDiscrepancies(
      type,
      dto.discrepancy_ids ?? [],
      scope,
    );

    const created = await this.createWithNumber(async (adjustmentNumber, tx) => {
      const row = await tx.inventoryAdjustment.create({
        data: {
          adjustmentNumber,
          warehouseId,
          classId: dto.class_id,
          departmentId: dto.department_id,
          adjustmentType: type,
          status: 'WaitingApproval',
          memo: dto.memo ?? null,
          createdById: scope.userId,
          items: { create: prepared.map((p) => this.itemData(p)) },
          discrepancies: {
            create: discrepancyIds.map((id) => ({ discrepancyId: id })),
          },
        },
      });
      await this.event(tx, row.id, 'created', {
        to: 'WaitingApproval',
        actorId: scope.userId,
      });
      return row;
    });


    this.logger.log(
      `Inventory adjustment ${created.adjustmentNumber} created and submitted for approval`,
    );
    return this.findOne(created.id, scope);
  }

  private itemData(p: PreparedLine) {
    return {
      materialId: p.materialId,
      materialCode: p.materialCode,
      materialName: p.materialName,
      warehouseId: p.warehouseId,
      binId: p.binId,
      binLabel: p.binLabel,
      qtyAdjustment: p.qtyAdjustment,
      qtyPassed: p.qtyPassed,
      qtyNonPassed: p.qtyNonPassed,
      availAtCreate: p.avail,
      qtyIssueAtCreate: p.qtyIssue,
      qualityIssueAtCreate: p.qualityIssue,
    };
  }

  /**
   * Allocate a document number and run `build` inside a transaction, retrying on
   * the unique-number constraint so two documents created at the same moment do
   * not fail the second caller.
   */
  private async createWithNumber<T>(
    build: (
      adjustmentNumber: string,
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const adjustmentNumber = await this.nextNumber();
      try {
        return await this.prisma.$transaction((tx) => build(adjustmentNumber, tx));
      } catch (e) {
        const isDuplicateNumber =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          String(e.meta?.target ?? '').includes('adjustment_number');
        if (!isDuplicateNumber) throw e;
        this.logger.warn(
          `Adjustment number ${adjustmentNumber} was taken; retrying (${attempt + 1}/5)`,
        );
      }
    }
    throw new BadRequestException(
      'Could not allocate an adjustment number — please try again',
    );
  }

  /**
   * Next document number for today. Derived from the highest suffix in use, not
   * from the row count: counting collides as soon as a document is removed (five
   * rows numbered 001-004 and 007 would propose 006, then 007 again).
   */
  private async nextNumber(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `ADJ-${today}-`;
    const rows = await this.prisma.inventoryAdjustment.findMany({
      where: { adjustmentNumber: { startsWith: prefix } },
      select: { adjustmentNumber: true },
    });
    const highest = rows.reduce((max, r) => {
      const n = Number(r.adjustmentNumber.slice(prefix.length));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  }

  private async mustFind(id: string, scope: WarehouseScope) {
    const a = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!a || !this.canSee(a, scope)) {
      throw new NotFoundException(`Inventory adjustment ${id} not found`);
    }
    return a;
  }

  // ---------- approve / reject (FR-IA-12) ----------

  async approve(
    id: string,
    dto: ApproveInventoryAdjustmentDto,
    scope: WarehouseScope,
  ) {
    const a = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: {
        items: true,
        createdBy: { select: { id: true, role: { select: { name: true } } } },
      },
    });
    if (!a || !this.canSee(a, scope)) {
      throw new NotFoundException(`Inventory adjustment ${id} not found`);
    }
    if (a.status !== 'WaitingApproval') {
      throw new BadRequestException(
        `Only documents waiting for approval can be decided (this one is ${a.status})`,
      );
    }

    const reason = dto.reason?.trim() || null;

    // FR-IA-12 rule 3.
    if (dto.action === 'reject') {
      if (!reason) throw new BadRequestException('A reason is required to reject');
      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryAdjustment.update({
          where: { id },
          data: {
            status: 'Rejected',
            approvedById: scope.userId,
            approvedAt: new Date(),
            approvalReason: reason,
          },
        });
        await this.event(tx, id, 'rejected', {
          from: 'WaitingApproval',
          to: 'Rejected',
          actorId: scope.userId,
          message: reason,
        });
      });
      this.logger.log(`Adjustment ${a.adjustmentNumber} rejected internally`);
      return this.findOne(id, scope);
    }

    // FR-IA-12 rule 2 / NFR-IA-P-02: segregation of duties. The approver must be
    // a different person AND hold a different role from the document's creator,
    // so one role cannot both raise and approve a stock change.
    if (a.createdById && a.createdById === scope.userId) {
      throw new ForbiddenException(
        'The approver must be a different user from the one who created the document',
      );
    }
    const creatorRole = a.createdBy?.role?.name ?? null;
    if (creatorRole && creatorRole === scope.role) {
      throw new ForbiddenException(
        `The approver must hold a different role from the creator (both are "${creatorRole}")`,
      );
    }

    // Record the internal approval FIRST so that a later Oracle failure leaves a
    // resendable document rather than losing the decision (FR-IA-16 rule 3).
    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryAdjustment.update({
        where: { id },
        data: {
          status: 'Approved',
          approvedById: scope.userId,
          approvedAt: new Date(),
          approvalReason: reason,
        },
      });
      await this.event(tx, id, 'approved', {
        from: 'WaitingApproval',
        to: 'Approved',
        actorId: scope.userId,
        message: reason,
      });
    });

    return this.advanceAfterApproval(id, scope);
  }

  /**
   * FR-IA-08 rule 7 / FR-IA-13 rule 3: a Quality Adjustment whose lines are all
   * Non-Passed never reaches Oracle — its stock effect is applied straight away.
   * Every other approved document is posted to Oracle.
   */
  private needsOracle(a: {
    adjustmentType: InventoryAdjustmentType;
    items: { qtyPassed: number }[];
  }): boolean {
    if (ruleFor(a.adjustmentType).oracleHit === 'always') return true;
    return a.items.some((it) => it.qtyPassed > EPS);
  }

  private async advanceAfterApproval(id: string, scope: WarehouseScope) {
    const a = await this.prisma.inventoryAdjustment.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    if (!this.needsOracle(a)) {
      // FR-IA-08 rule 8: applied directly after internal approval.
      await this.applyStockAndComplete(id, scope.userId, 'Not sent to Oracle (no Qty Passed)');
      return this.findOne(id, scope);
    }

    return this.sendToOracle(id, scope);
  }

  // ---------- Oracle integration (FR-IA-13, FR-IA-16) ----------

  /** Post to Oracle. Used by approval and by the manual resend of a failed send. */
  async sendToOracle(id: string, scope: WarehouseScope) {
    const a = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: {
        warehouse: { select: { oracleId: true } },
        class: { select: { oracleId: true } },
        department: { select: { oracleId: true } },
        createdBy: { select: { department: { select: { oracleId: true } } } },
        items: {
          include: {
            material: { select: { erpDocId: true } },
            warehouse: { select: { oracleId: true } },
          },
        },
        discrepancies: {
          include: { discrepancy: { select: { discrepancyId: true } } },
        },
      },
    });
    if (!a || !this.canSee(a, scope)) {
      throw new NotFoundException(`Inventory adjustment ${id} not found`);
    }
    if (a.status !== 'Approved') {
      throw new BadRequestException(
        `Only internally approved documents can be sent to Oracle (this one is ${a.status})`,
      );
    }
    // FR-IA-13 rule 7 / FR-IA-16 rule 4: never post the same document twice.
    if (a.oracleId && a.oracleId !== '-') {
      throw new BadRequestException(
        `This document was already sent to Oracle (id ${a.oracleId})`,
      );
    }

    try {
      const oracle = await this.postToOracle(a);
      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryAdjustment.update({
          where: { id },
          data: {
            status: 'WaitingOracleApproval',
            oracleId: String(oracle.inventoryAdjustmentId),
            oracleApprovalStatus: 'Pending Approval',
            oracleSentAt: new Date(),
            oracleError: null,
          },
        });
        await this.event(tx, id, 'oracle_sent', {
          from: 'Approved',
          to: 'WaitingOracleApproval',
          actorId: scope.userId,
          message: `Oracle IA ${oracle.inventoryAdjustmentId}: ${oracle.message}`,
        });
      });
      this.logger.log(
        `Adjustment ${a.adjustmentNumber} sent to Oracle (IA ${oracle.inventoryAdjustmentId})`,
      );
    } catch (e) {
      // FR-IA-16 rules 1-3: no stock change, document stays resendable.
      const msg = (e as Error).message?.slice(0, 1000) ?? 'Oracle send failed';
      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryAdjustment.update({
          where: { id },
          data: { oracleError: msg },
        });
        await this.event(tx, id, 'oracle_failed', {
          from: 'Approved',
          to: 'Approved',
          actorId: scope.userId,
          message: msg,
        });
      });
      this.logger.warn(`Adjustment ${a.adjustmentNumber} failed to reach Oracle: ${msg}`);
    }

    return this.findOne(id, scope);
  }

  /**
   * FR-IA-13 rule 5/6: read the Oracle-side approval status and settle the
   * document. Triggered manually from the detail page.
   */
  async checkOracle(id: string, scope: WarehouseScope) {
    const a = await this.mustFind(id, scope);
    if (a.status !== 'WaitingOracleApproval') {
      throw new BadRequestException(
        `Only documents waiting for the Oracle decision can be checked (this one is ${a.status})`,
      );
    }
    if (!a.oracleId || a.oracleId === '-') {
      throw new BadRequestException('This document has no Oracle id yet');
    }

    let display: string | null;
    try {
      display = await this.fetchOracleStatus(id, a.oracleId);
    } catch (e) {
      throw new ServiceUnavailableException(
        `Could not read the Oracle status: ${(e as Error).message}`,
      );
    }

    if (display == null) {
      return {
        ...(await this.findOne(id, scope)),
        oracle_check: {
          found: false,
          message:
            'The document was not found in the Oracle inventory adjustment list yet. Try again later.',
        },
      };
    }

    const normalized = display.trim().toLowerCase();

    if (normalized === 'approved') {
      await this.applyStockAndComplete(id, scope.userId, `Oracle: ${display}`);
      return {
        ...(await this.findOne(id, scope)),
        oracle_check: { found: true, status: display, message: 'Approved by Oracle' },
      };
    }

    if (normalized.includes('reject')) {
      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryAdjustment.update({
          where: { id },
          data: {
            status: 'RejectedByOracle',
            oracleApprovalStatus: display!,
            oracleRejectReason: display,
          },
        });
        await this.event(tx, id, 'oracle_rejected', {
          from: 'WaitingOracleApproval',
          to: 'RejectedByOracle',
          actorId: scope.userId,
          message: `Oracle: ${display}`,
        });
      });
      return {
        ...(await this.findOne(id, scope)),
        oracle_check: { found: true, status: display, message: 'Rejected by Oracle' },
      };
    }

    // Still pending — record the label, leave the status alone.
    await this.prisma.inventoryAdjustment.update({
      where: { id },
      data: { oracleApprovalStatus: display },
    });
    return {
      ...(await this.findOne(id, scope)),
      oracle_check: { found: true, status: display, message: 'Still awaiting the Oracle decision' },
    };
  }

  /**
   * Ask Oracle for this document's approval label. The bridge exposes a direct
   * lookup that takes the ids returned when the adjustment was created:
   *   POST /inventory/adjustments/get-status  { "id": [66444] }
   * Returns null when the id is not known to Oracle.
   */
  private async fetchOracleStatus(
    adjustmentId: string,
    oracleId: string,
  ): Promise<string | null> {
    const numeric = Number(oracleId);
    const endpoint = '/inventory/adjustments/get-status';
    const request = { id: [Number.isFinite(numeric) ? numeric : oracleId] };
    const startedAt = Date.now();

    let res: OracleAdjustmentStatusResponse;
    try {
      res = await this.erp.post<OracleAdjustmentStatusResponse>(endpoint, request);
    } catch (e) {
      await this.logIntegration({
        adjustmentId,
        operation: 'status_check',
        endpoint,
        request,
        ok: false,
        error: (e as Error).message,
        durationMs: Date.now() - startedAt,
      });
      throw e;
    }

    const hit = (res?.data ?? []).find(
      (r) => r?.id != null && String(r.id) === String(oracleId),
    );

    await this.logIntegration({
      adjustmentId,
      operation: 'status_check',
      endpoint,
      request,
      response: res,
      ok: true,
      error: hit ? null : 'Document not present in the response',
      durationMs: Date.now() - startedAt,
    });

    if (!hit) return null;

    return (
      hit.custbody_me_approval_status_display?.trim() ||
      hit.custbody_me_approval_status?.trim() ||
      ''
    );
  }

  // Build the Oracle Inventory Adjustment payload and POST it. Every attempt is
  // written to the integration log, successful or not.
  private async postToOracle(a: {
    id: string;
    adjustmentNumber: string;
    warehouse: { oracleId: string | null } | null;
    class: { oracleId: string } | null;
    department: { oracleId: string } | null;
    createdBy: { department: { oracleId: string } | null } | null;
    memo: string | null;
    adjustmentType: InventoryAdjustmentType;
    items: {
      qtyAdjustment: number;
      qtyPassed: number;
      material: { erpDocId: string | null } | null;
      warehouse: { oracleId: string | null } | null;
    }[];
    discrepancies: { discrepancy: { discrepancyId: string } }[];
  }): Promise<{ inventoryAdjustmentId: number; message: string }> {
    const locationOracle = a.warehouse?.oracleId;
    const classOracle = a.class?.oracleId;
    // The header department; documents from before it existed fall back to the
    // creator's.
    const deptOracle = a.department?.oracleId ?? a.createdBy?.department?.oracleId;

    if (!locationOracle) {
      throw new BadRequestException(
        'Warehouse has no Oracle location id — cannot post to Oracle',
      );
    }
    if (!classOracle) {
      throw new BadRequestException(
        'Class is not set on this adjustment — cannot post to Oracle',
      );
    }
    if (!deptOracle) {
      throw new BadRequestException(
        "The creator's department (Oracle) is missing — cannot post to Oracle",
      );
    }

    const location = Number(locationOracle);
    const department = Number(deptOracle);
    const rule = ruleFor(a.adjustmentType);

    // Group lines by item and location so multiple bins of one material in one
    // warehouse go out as ONE Oracle line with the summed quantity.
    const qtyByLine = new Map<string, { item: number; location: number; quantity: number }>();
    for (const it of a.items) {
      const item = Number(it.material?.erpDocId);
      if (!Number.isFinite(item)) continue;
      const lineLocation = Number(it.warehouse?.oracleId ?? locationOracle);
      if (!Number.isFinite(lineLocation)) {
        throw new BadRequestException(
          'A line warehouse has no Oracle location id — cannot post to Oracle',
        );
      }
      // Quality Adjustment only moves Qty Passed on the Oracle side.
      const q = rule.qtyMode === 'passed_non_passed' ? it.qtyPassed : it.qtyAdjustment;
      const key = `${item}|${lineLocation}`;
      const row = qtyByLine.get(key) ?? { item, location: lineLocation, quantity: 0 };
      row.quantity += q;
      qtyByLine.set(key, row);
    }
    const lines = [...qtyByLine.values()]
      .map((l) => ({ ...l, department }))
      .filter((l) => Math.abs(l.quantity) > EPS);
    if (lines.length === 0) {
      throw new BadRequestException(
        'No postable lines (missing item erp id or zero quantity)',
      );
    }

    const payload = {
      customform: ADJ_CUSTOMFORM,
      subsidiary: ADJ_SUBSIDIARY,
      account: ADJ_ACCOUNT,
      adjlocation: location,
      department,
      class: Number(classOracle),
      // FR-IA-03: "{IA Type} | {memo}".
      memo: buildOracleMemo(a.adjustmentType, a.memo),
      // Document number + attached discrepancy references, for reconciliation.
      custbody_me_description: [
        a.adjustmentNumber,
        ...a.discrepancies.map((d) => d.discrepancy.discrepancyId),
      ]
        .filter(Boolean)
        .join(', '),
      lines,
    };

    const endpoint = '/inventory/adjustments';
    const startedAt = Date.now();
    let res: { ok: boolean; status: number; body: OracleAdjustmentResponse | null };
    try {
      res = await this.erp.postRaw<OracleAdjustmentResponse>(endpoint, payload);
    } catch (e) {
      const msg = `Failed to reach Oracle Inventory Adjustment: ${(e as Error).message}`;
      await this.logIntegration({
        adjustmentId: a.id,
        operation: 'post',
        endpoint,
        request: payload,
        ok: false,
        error: msg,
        durationMs: Date.now() - startedAt,
      });
      throw new ServiceUnavailableException(msg);
    }

    const body = res.body;
    const invId = body?.inventory_adjustment_id;
    const ok =
      (body?.status === 'success' || body?.success === true) && invId != null;

    await this.logIntegration({
      adjustmentId: a.id,
      operation: 'post',
      endpoint,
      request: payload,
      response: body,
      httpStatus: res.status,
      ok,
      error: ok ? null : (body?.message ?? `HTTP ${res.status}`),
      durationMs: Date.now() - startedAt,
    });

    if (!ok) {
      throw new ServiceUnavailableException(
        body?.message ?? `Oracle Inventory Adjustment failed (HTTP ${res.status})`,
      );
    }
    return {
      inventoryAdjustmentId: invId,
      message: body?.message ?? 'Inventory Adjustment created',
    };
  }

  // ---------- stock update (FR-IA-14) ----------

  /**
   * Apply every line's bucket movement and mark the document Completed, all in
   * one transaction: either all lines land or none do (FR-IA-14 rule 1).
   */
  private async applyStockAndComplete(
    id: string,
    actorId: number,
    note: string,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const a = await tx.inventoryAdjustment.findUniqueOrThrow({
          where: { id },
          include: { items: true },
        });
        if (a.status === 'Completed') return; // idempotent

        const lines = a.items.filter((it) => it.binId && it.materialId);

        // NFR-IA-T-02: read every bin once, then write every bin in a single
        // statement, so a 300-line document is 2 round-trips instead of 600.
        const stocks = await tx.inventoryBinStock.findMany({
          where: {
            binId: { in: lines.map((it) => it.binId!) },
            inventory: {
              materialId: { in: lines.map((it) => it.materialId!) },
            },
          },
          include: { inventory: { select: { materialId: true } } },
        });
        const stockByKey = new Map(
          stocks.map((st) => [`${st.inventory.materialId}|${st.binId}`, st]),
        );

        const updates: {
          id: string;
          inventoryId: string;
          binId: string | null;
          avail: number;
          quality: number;
          qtyIssue: number;
          deltaAvail: number;
          deltaQuality: number;
          deltaQtyIssue: number;
          reservedAfter: number;
          inTransitAfter: number;
        }[] = [];

        for (const it of lines) {
          const stock = stockByKey.get(`${it.materialId}|${it.binId}`);
          if (!stock) {
            throw new Error(
              `Bin stock for ${it.materialCode} @ ${it.binLabel} no longer exists`,
            );
          }

          const d = stockEffect(a.adjustmentType, it);
          const nextAvail = stock.availQty + d.availQty;
          const nextQuality = stock.qualityIssue + d.qualityIssue;
          const nextQtyIssue = d.zeroQtyIssue ? 0 : stock.qtyIssue + d.qtyIssue;

          // FR-IA-14 rule 5: another transaction may have moved the stock since
          // the document was written — refuse rather than go negative.
          if (nextAvail < -EPS) {
            throw new Error(
              `${it.materialCode} @ ${it.binLabel}: available would become ${nextAvail} (stock changed since the document was created)`,
            );
          }
          if (nextQuality < -EPS) {
            throw new Error(
              `${it.materialCode} @ ${it.binLabel}: Quality Issue would become ${nextQuality} (stock changed since the document was created)`,
            );
          }

          updates.push({
            id: stock.id,
            inventoryId: stock.inventoryId,
            binId: stock.binId,
            avail: nextAvail,
            quality: nextQuality,
            qtyIssue: nextQtyIssue,
            deltaAvail: nextAvail - stock.availQty,
            deltaQuality: nextQuality - stock.qualityIssue,
            deltaQtyIssue: nextQtyIssue - stock.qtyIssue,
            reservedAfter: stock.reservedQty,
            inTransitAfter: stock.inTransitQty,
          });
        }

        if (updates.length > 0) {
          // updated_at is maintained by Prisma on normal writes, so a raw update
          // has to set it explicitly.
          const values = Prisma.join(
            updates.map(
              (u) =>
                Prisma.sql`(${u.id}::text, ${u.avail}::double precision, ${u.quality}::double precision, ${u.qtyIssue}::double precision)`,
            ),
          );
          await tx.$executeRaw`
            UPDATE "inventory_bin_stocks" AS bs
            SET "avail_qty" = v.avail,
                "quality_issue" = v.quality,
                "qty_issue" = v.qty_issue,
                "updated_at" = NOW()
            FROM (VALUES ${values}) AS v(id, avail, quality, qty_issue)
            WHERE bs."id" = v.id
          `;

          // FR-IA-14 rule 4 / NFR-IA-L-05: one ledger row per bin touched.
          for (const u of updates) {
            await this.inventory.recordMovement(
              tx,
              u.inventoryId,
              u.binId,
              {
                avail: u.deltaAvail,
                reserved: 0,
                inTransit: 0,
                quality: u.deltaQuality,
                qtyIssue: u.deltaQtyIssue,
              },
              {
                avail: u.avail,
                reserved: u.reservedAfter,
                inTransit: u.inTransitAfter,
                quality: u.quality,
                qtyIssue: u.qtyIssue,
              },
              {
                module: 'inventory-adjustment',
                id: a.id,
                number: a.adjustmentNumber,
                actorId,
                note: `${ruleFor(a.adjustmentType).oracleLabel} — ${note}`,
              },
            );
          }
        }

        await tx.inventoryAdjustment.update({
          where: { id },
          data: {
            status: 'Completed',
            completedAt: new Date(),
            oracleApprovalStatus:
              a.oracleId && a.oracleId !== '-' ? 'Approved' : a.oracleApprovalStatus,
          },
        });
        await this.event(tx, id, 'completed', {
          from: a.status,
          to: 'Completed',
          actorId,
          message: note,
        });
      },
      // Prisma's default interactive-transaction budget is 5s; a document with
      // hundreds of lines needs more headroom.
      { maxWait: 10_000, timeout: 60_000 });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 1000) ?? 'Stock update failed';
      // FR-IA-14 rule 5: flag the document so it can be followed up; no partial
      // stock change happened because the transaction rolled back.
      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryAdjustment.update({
          where: { id },
          data: { oracleError: `Stock update failed: ${msg}` },
        });
        await this.event(tx, id, 'stock_failed', {
          actorId,
          message: msg,
        });
      });
      this.logger.error(`Stock update failed for adjustment ${id}: ${msg}`);
      throw new BadRequestException(`Stock update failed: ${msg}`);
    }
  }

  // ---------- read ----------

  /** One filter field → a where clause. Free text matches by "contains". */
  private filterWhere(field: IaFilterField, raw: string): Prisma.InventoryAdjustmentWhereInput {
    const v = raw.trim();
    const contains = { contains: v, mode: 'insensitive' as const };
    switch (field) {
      case 'created_at':
        return { createdAt: parseDateRange(v) };
      case 'material_code':
        return { items: { some: { materialCode: contains } } };
      case 'material_name':
        return { items: { some: { materialName: contains } } };
      case 'bin':
        return {
          items: {
            some: {
              OR: [
                { binLabel: contains },
                { bin: { binCode: contains } },
                { bin: { binLabel: contains } },
              ],
            },
          },
        };
      case 'warehouse':
        return {
          OR: [
            { warehouse: { name: contains } },
            { items: { some: { warehouse: { name: contains } } } },
          ],
        };
      case 'created_by':
        return { createdBy: { name: contains } };
      case 'type': {
        // Typed as text, matched against the labels people see.
        const needle = v.toLowerCase();
        const types = IA_TYPES.filter(
          (t) =>
            ruleFor(t).oracleLabel.toLowerCase().includes(needle) ||
            t.toLowerCase().includes(needle.replace(/\s+/g, '')),
        );
        return { adjustmentType: { in: types } };
      }
    }
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      adjustment_type?: string;
      status?: string;
      filters?: { field: IaFilterField; values: string[] }[];
      sort_by?: string;
      sort_order?: string;
    },
    scope: WarehouseScope,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, {
      createdAt: 'desc',
    });

    const and: Prisma.InventoryAdjustmentWhereInput[] = [this.scopeWhere(scope)];
    if (
      query.adjustment_type &&
      IA_TYPES.includes(query.adjustment_type as InventoryAdjustmentType)
    ) {
      and.push({ adjustmentType: query.adjustment_type as InventoryAdjustmentType });
    }
    if (query.status) {
      and.push({ status: query.status as InventoryAdjustmentStatus });
    }
    if (query.search) {
      and.push({ adjustmentNumber: { contains: query.search, mode: 'insensitive' } });
    }
    // OR within a field, AND across fields.
    for (const f of query.filters ?? []) {
      const values = f.values.map((v) => v.trim()).filter(Boolean);
      if (values.length) and.push({ OR: values.map((v) => this.filterWhere(f.field, v)) });
    }
    const where: Prisma.InventoryAdjustmentWhereInput = { AND: and };

    // One list row per document AND warehouse: a document spanning three
    // warehouses shows as three rows, each holding only its own lines.
    const docs = await this.prisma.inventoryAdjustment.findMany({
      where,
      orderBy,
      select: { id: true, warehouseId: true },
    });
    const lines = await this.prisma.inventoryAdjustmentItem.findMany({
      where: { adjustmentId: { in: docs.map((d) => d.id) } },
      select: {
        adjustmentId: true,
        warehouseId: true,
        materialCode: true,
        materialName: true,
        binLabel: true,
        bin: { select: { binCode: true, binLabel: true } },
        warehouse: { select: { name: true } },
      },
    });
    type Pair = { adjustmentId: string; warehouseId: string; name: string; lines: typeof lines };
    const pairsByDoc = new Map<string, Map<string, Pair>>();
    const headerWh = new Map(docs.map((d) => [d.id, d.warehouseId]));
    for (const l of lines) {
      const wh = l.warehouseId ?? headerWh.get(l.adjustmentId)!;
      const byWh = pairsByDoc.get(l.adjustmentId) ?? new Map<string, Pair>();
      const pair = byWh.get(wh) ?? { adjustmentId: l.adjustmentId, warehouseId: wh, name: l.warehouse?.name ?? '', lines: [] };
      pair.lines.push(l);
      byWh.set(wh, pair);
      pairsByDoc.set(l.adjustmentId, byWh);
    }

    // Line-level filters and the warehouse scope decide which of a document's
    // warehouses are listed; the document-level ones were applied in SQL.
    const lineFilters = (query.filters ?? [])
      .filter((f) => ['material_code', 'material_name', 'bin', 'warehouse'].includes(f.field))
      .map((f) => ({ field: f.field, values: f.values.map((v) => v.trim().toLowerCase()).filter(Boolean) }))
      .filter((f) => f.values.length);
    const hay = (field: IaFilterField, l: (typeof lines)[number], pair: Pair) =>
      (field === 'material_code'
        ? (l.materialCode ?? '')
        : field === 'material_name'
          ? (l.materialName ?? '')
          : field === 'bin'
            ? `${l.binLabel ?? ''} ${l.bin?.binCode ?? ''} ${l.bin?.binLabel ?? ''}`
            : pair.name
      ).toLowerCase();
    const keep = (pair: Pair) =>
      inScope(scope, pair.warehouseId) &&
      lineFilters.every((f) => pair.lines.some((l) => f.values.some((v) => hay(f.field, l, pair).includes(v))));

    let pairs = docs.flatMap((d) =>
      [...(pairsByDoc.get(d.id)?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)).filter(keep),
    );
    if (query.sort_by === 'warehouse') {
      const dir = query.sort_order === 'desc' ? -1 : 1;
      pairs = [...pairs].sort((a, b) => dir * a.name.localeCompare(b.name));
    }

    const total = pairs.length;
    const pagePairs = pairs.slice((page - 1) * limit, page * limit);
    const full = await this.prisma.inventoryAdjustment.findMany({
      where: { id: { in: [...new Set(pagePairs.map((p) => p.adjustmentId))] } },
      include: listInclude,
    });
    const byId = new Map(full.map((a) => [a.id, a]));

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
        status: query.status ?? null,
        adjustment_type: query.adjustment_type ?? null,
      },
      rows: pagePairs.map((p) => this.serializeList(byId.get(p.adjustmentId)!, p.warehouseId)),
    };
  }

  /** Create-form default: the signed-in user's own department. */
  async defaults(scope: WarehouseScope) {
    const user = await this.prisma.user.findUnique({
      where: { id: scope.userId },
      select: { departmentId: true },
    });
    return { department_id: user?.departmentId ?? null };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const a = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!a || !this.canSee(a, scope)) {
      throw new NotFoundException(`Inventory adjustment ${id} not found`);
    }
    return this.serializeDetail(a);
  }

  /** The behaviour matrix, so the UI does not have to duplicate the rules. */
  types() {
    return IA_TYPES.map((t) => {
      const r = ruleFor(t);
      return {
        value: t,
        label: r.oracleLabel,
        qty_mode: r.qtyMode,
        filter_bucket: r.filterBucket,
        discrepancy_list: r.discrepancyList,
        oracle_hit: r.oracleHit,
      };
    });
  }

  // ---------- serializers ----------

  private lineQty(
    type: InventoryAdjustmentType,
    it: { qtyAdjustment: number; qtyPassed: number; qtyNonPassed: number },
  ) {
    return ruleFor(type).qtyMode === 'passed_non_passed'
      ? it.qtyPassed + it.qtyNonPassed
      : it.qtyAdjustment;
  }

  /** "Multiple warehouses" once the lines span more than one. */
  private warehouseLabel(a: AdjList | AdjDetail): string | null {
    const names = new Set(
      a.items.map((it) => it.warehouse?.name).filter((n): n is string => !!n),
    );
    if (names.size > 1) return 'Multiple warehouses';
    return [...names][0] ?? a.warehouse?.name ?? null;
  }

  /** The bucket a line's "Before Adjustment" refers to. */
  private beforeQty(
    type: InventoryAdjustmentType,
    it: { availAtCreate: number; qtyIssueAtCreate: number; qualityIssueAtCreate: number },
  ) {
    const bucket = ruleFor(type).filterBucket;
    if (bucket === 'qty_issue') return it.qtyIssueAtCreate;
    if (bucket === 'quality_issue') return it.qualityIssueAtCreate;
    return it.availAtCreate;
  }

  private serializeLine(type: InventoryAdjustmentType, it: AdjList['items'][number]) {
    return {
      id: it.id,
      material_id: it.materialId,
      material_code: it.materialCode,
      material_name: it.materialName,
      warehouse_id: it.warehouseId,
      warehouse_name: it.warehouse?.name ?? null,
      warehouse_parent: it.warehouse?.parentName ?? null,
      bin_id: it.binId,
      bin_code: it.bin?.binCode ?? null,
      bin_label: it.binLabel ?? it.bin?.binLabel ?? null,
      before_qty: this.beforeQty(type, it),
      qty_adjustment: it.qtyAdjustment,
      qty_passed: it.qtyPassed,
      qty_non_passed: it.qtyNonPassed,
      avail_at_create: it.availAtCreate,
      qty_issue_at_create: it.qtyIssueAtCreate,
      quality_issue_at_create: it.qualityIssueAtCreate,
    };
  }

  /** One document in one warehouse: the header plus only that warehouse's lines. */
  private serializeList(a: AdjList, warehouseId: string) {
    const items = a.items.filter((it) => (it.warehouseId ?? a.warehouseId) === warehouseId);
    const wh = items[0]?.warehouse ?? (a.warehouseId === warehouseId ? a.warehouse : null);
    const materials = new Set(items.map((it) => it.materialId ?? it.materialCode));
    const bins = new Set(items.map((it) => it.binId ?? it.binLabel));
    const warehouseCount = new Set(a.items.map((it) => it.warehouseId ?? a.warehouseId)).size;
    return {
      id: `${a.id}:${warehouseId}`,
      adjustment_id: a.id,
      adjustment_number: a.adjustmentNumber,
      warehouse_id: warehouseId,
      warehouse: wh?.name ?? null,
      warehouse_parent: wh?.parentName ?? null,
      // How many warehouses the whole document spans (this row is one of them).
      warehouse_count: warehouseCount,
      adjustment_type: a.adjustmentType,
      adjustment_type_label: ruleFor(a.adjustmentType).oracleLabel,
      status: a.status,
      material_count: materials.size,
      bin_count: bins.size,
      total_qty: items.reduce((s, it) => s + this.lineQty(a.adjustmentType, it), 0),
      discrepancy_count: a._count.discrepancies,
      class_name: a.class?.name ?? null,
      department_name: a.department?.name ?? null,
      ownership: wh?.subsidiaryName ?? a.warehouse?.subsidiaryName ?? null,
      oracle_id: a.oracleId,
      oracle_approval_status: a.oracleApprovalStatus,
      oracle_error: a.oracleError,
      created_by: a.createdBy?.name ?? null,
      created_at: a.createdAt,
      items: items.map((it) => this.serializeLine(a.adjustmentType, it)),
    };
  }

  private serializeDetail(a: AdjDetail) {
    const rule = ruleFor(a.adjustmentType);
    return {
      id: a.id,
      adjustment_number: a.adjustmentNumber,
      warehouse: this.warehouseLabel(a),
      warehouse_id: a.warehouseId,
      ownership: a.warehouse?.subsidiaryName ?? null,
      department_id: a.departmentId,
      department_name: a.department?.name ?? null,
      class_id: a.classId,
      class_name: a.class?.name ?? null,
      class_oracle_id: a.class?.oracleId ?? null,
      adjustment_type: a.adjustmentType,
      adjustment_type_label: rule.oracleLabel,
      qty_mode: rule.qtyMode,
      status: a.status,
      memo: a.memo,
      // FR-IA-03: exactly what Oracle receives.
      oracle_memo: buildOracleMemo(a.adjustmentType, a.memo),
      oracle_id: a.oracleId,
      oracle_approval_status: a.oracleApprovalStatus,
      oracle_sent_at: a.oracleSentAt,
      oracle_error: a.oracleError,
      oracle_reject_reason: a.oracleRejectReason,
      completed_at: a.completedAt,
      created_by: a.createdBy?.name ?? null,
      created_at: a.createdAt,
      approved_by: a.approvedBy?.name ?? null,
      approved_at: a.approvedAt,
      approval_reason: a.approvalReason,
      total_qty: a.items.reduce((s, it) => s + this.lineQty(a.adjustmentType, it), 0),
      items: a.items.map((it) => this.serializeLine(a.adjustmentType, it)),
      discrepancies: a.discrepancies.map((d) => ({
        id: d.discrepancy.id,
        discrepancy_id: d.discrepancy.discrepancyId,
        type: d.discrepancy.discrepancyType,
        from: d.discrepancy.discrepancyFrom,
      })),
      // FR-IA-13 rule 8 / FR-IA-16 rule 6: raw Oracle traffic for reconciliation.
      integration_logs: a.integrationLogs.map((l) => ({
        id: l.id,
        operation: l.operation,
        endpoint: l.endpoint,
        request: l.request,
        response: l.response,
        http_status: l.httpStatus,
        ok: l.ok,
        error: l.error,
        duration_ms: l.durationMs,
        created_at: l.createdAt,
      })),
      // FR-IA-15: the audit trail.
      events: a.events.map((e) => ({
        id: e.id,
        action: e.action,
        from_status: e.fromStatus,
        to_status: e.toStatus,
        actor: e.actor?.name ?? null,
        message: e.message,
        created_at: e.createdAt,
      })),
    };
  }
}
