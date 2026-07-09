import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import type { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import type { ApproveInventoryAdjustmentDto } from './dto/approve-inventory-adjustment.dto';

export interface WarehouseScope {
  userId: number;
  role: string;
  warehouseId: string | null;
}

// Static header values for the Oracle inventory adjustment (env-overridable).
const ADJ_CUSTOMFORM = Number(process.env.ORACLE_ADJ_CUSTOMFORM ?? 112);
const ADJ_SUBSIDIARY = Number(process.env.ORACLE_ADJ_SUBSIDIARY ?? 6);
const ADJ_ACCOUNT = Number(process.env.ORACLE_ADJ_ACCOUNT ?? 53);

interface OracleAdjustmentResponse {
  status?: string;
  success?: boolean;
  message?: string;
  inventory_adjustment_id?: number;
}

// Adjustment type -> the discrepancy type that may be attached as a memo.
const DISCREPANCY_TYPE_FOR: Record<string, 'quantity' | 'quality'> = {
  qty_issue: 'quantity',
  quality_issue: 'quality',
};

const listInclude = {
  warehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: true,
  _count: { select: { discrepancies: true } },
} satisfies Prisma.InventoryAdjustmentInclude;

const detailInclude = {
  warehouse: { select: { id: true, name: true } },
  class: { select: { id: true, name: true, oracleId: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  items: {
    include: { bin: { select: { binLabel: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
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
  created_by: (d) => ({ createdBy: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
};

@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
  ) {}

  private scopeWhere(scope: WarehouseScope): Prisma.InventoryAdjustmentWhereInput {
    if (scope.role === 'admin') {
      return scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
    }
    return { warehouseId: scope.warehouseId ?? '__no_warehouse__' };
  }

  // The concrete warehouse to act on. Admin "All" (null) can't create/lookup.
  private requireWarehouse(scope: WarehouseScope): string {
    if (!scope.warehouseId) {
      throw new BadRequestException(
        'Select a specific warehouse first (Inventory Adjustment cannot use "All sites")',
      );
    }
    return scope.warehouseId;
  }

  // ---------- lookups (create form) ----------

  // Materials that have inventory in the active warehouse.
  async materialOptions(scope: WarehouseScope) {
    const warehouseId = this.requireWarehouse(scope);
    const invs = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId, materialId: { not: null } },
      select: {
        materialId: true,
        materialCode: true,
        material: { select: { materialName: true } },
      },
      orderBy: { materialCode: 'asc' },
    });
    return invs.map((i) => ({
      material_id: i.materialId,
      material_code: i.materialCode,
      material_name: i.material?.materialName ?? null,
    }));
  }

  // Bins holding the given material (+ their current quantities) for context.
  async binOptions(materialId: string, scope: WarehouseScope) {
    const warehouseId = this.requireWarehouse(scope);
    const inv = await this.prisma.inventoryManagement.findFirst({
      where: { warehouseId, materialId },
      include: {
        binStocks: {
          where: { binId: { not: null } },
          include: { bin: { select: { binLabel: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!inv) return [];
    return inv.binStocks.map((bs) => ({
      bin_id: bs.binId,
      bin_label: bs.bin?.binLabel ?? null,
      qty_available: bs.availQty,
      qty_issue: bs.qtyIssue,
      quality_issue: bs.qualityIssue,
    }));
  }

  // ---------- create ----------

  async create(dto: CreateInventoryAdjustmentDto, scope: WarehouseScope) {
    const warehouseId = this.requireWarehouse(scope);
    const type = dto.adjustment_type;
    if (!dto.items?.length) {
      throw new BadRequestException('At least one material/bin line is required');
    }

    // Header class (sent to Oracle on approval).
    const klass = await this.prisma.class.findUnique({
      where: { id: dto.class_id },
      select: { id: true },
    });
    if (!klass) {
      throw new BadRequestException('Selected class does not exist');
    }

    // Validate each line against the inventory bin stock and snapshot context.
    const seen = new Set<string>();
    const prepared: {
      materialId: string;
      materialCode: string | null;
      materialName: string | null;
      binId: string;
      binLabel: string | null;
      qtyAdjustment: number;
      qtyScrapped: number;
      qtyPassed: number;
      avail: number;
      qtyIssue: number;
      qualityIssue: number;
    }[] = [];

    for (const line of dto.items) {
      const key = `${line.material_id}|${line.bin_id}`;
      if (seen.has(key)) {
        throw new BadRequestException('Duplicate material/bin line');
      }
      seen.add(key);

      const inv = await this.prisma.inventoryManagement.findFirst({
        where: { warehouseId, materialId: line.material_id },
        select: { materialCode: true, material: { select: { materialName: true } } },
      });
      if (!inv) {
        throw new BadRequestException(
          'Material is not in inventory for this warehouse',
        );
      }
      const stock = await this.prisma.inventoryBinStock.findFirst({
        where: {
          binId: line.bin_id,
          inventory: { warehouseId, materialId: line.material_id },
        },
        include: { bin: { select: { binLabel: true } } },
      });
      if (!stock) {
        throw new BadRequestException(
          'Selected bin does not hold this material in this warehouse',
        );
      }

      const qtyAdjustment = Number(line.qty_adjustment) || 0;
      const qtyScrapped = Number(line.qty_scrapped) || 0;
      const qtyPassed = Number(line.qty_passed) || 0;

      if (type === 'qty_issue') {
        // Signed delta: + adds to available, - reduces it. Must not zero-input
        // and must not drive available below 0.
        if (qtyAdjustment === 0) {
          throw new BadRequestException('Qty adjustment cannot be 0');
        }
        if (stock.availQty + qtyAdjustment < -1e-9) {
          throw new BadRequestException(
            `Adjustment (${qtyAdjustment}) would make available negative (current ${stock.availQty})`,
          );
        }
      } else {
        const total = qtyScrapped + qtyPassed;
        if (!(total > 0)) {
          throw new BadRequestException(
            'Enter qty scrapped and/or qty passed (total must be > 0)',
          );
        }
        if (total > stock.availQty + 1e-9) {
          throw new BadRequestException(
            `Scrapped + passed (${total}) exceeds available (${stock.availQty})`,
          );
        }
      }

      prepared.push({
        materialId: line.material_id,
        materialCode: inv.materialCode,
        materialName: inv.material?.materialName ?? null,
        binId: line.bin_id,
        binLabel: stock.bin?.binLabel ?? null,
        qtyAdjustment: type === 'qty_issue' ? qtyAdjustment : 0,
        qtyScrapped: type === 'quality_issue' ? qtyScrapped : 0,
        qtyPassed: type === 'quality_issue' ? qtyPassed : 0,
        avail: stock.availQty,
        qtyIssue: stock.qtyIssue,
        qualityIssue: stock.qualityIssue,
      });
    }

    // Validate attached discrepancy docs (memo). Must match the adjustment type
    // and be visible in the same warehouse.
    const discrepancyIds = [...new Set(dto.discrepancy_ids ?? [])];
    if (discrepancyIds.length > 0) {
      const wantType = DISCREPANCY_TYPE_FOR[type];
      const found = await this.prisma.discrepancy.findMany({
        where: { id: { in: discrepancyIds } },
        select: { id: true, discrepancyType: true, warehouseId: true },
      });
      const byId = new Map(found.map((d) => [d.id, d]));
      for (const id of discrepancyIds) {
        const d = byId.get(id);
        if (!d) throw new BadRequestException(`Discrepancy ${id} not found`);
        if (d.discrepancyType !== wantType) {
          throw new BadRequestException(
            `Discrepancy must be of type "${wantType}" for this adjustment`,
          );
        }
        if (
          scope.role !== 'admin' &&
          d.warehouseId !== scope.warehouseId
        ) {
          throw new BadRequestException(`Discrepancy ${id} not found`);
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.inventoryAdjustment.count({
      where: { adjustmentNumber: { startsWith: `ADJ-${today}` } },
    });
    const adjustmentNumber = `ADJ-${today}-${String(count + 1).padStart(3, '0')}`;

    const created = await this.prisma.inventoryAdjustment.create({
      data: {
        adjustmentNumber,
        warehouseId,
        classId: dto.class_id,
        adjustmentType: type,
        status: 'PendingApproval',
        note: dto.note ?? null,
        createdById: scope.userId,
        items: {
          create: prepared.map((p) => ({
            materialId: p.materialId,
            materialCode: p.materialCode,
            materialName: p.materialName,
            binId: p.binId,
            binLabel: p.binLabel,
            qtyAdjustment: p.qtyAdjustment,
            qtyScrapped: p.qtyScrapped,
            qtyPassed: p.qtyPassed,
            availAtCreate: p.avail,
            qtyIssueAtCreate: p.qtyIssue,
            qualityIssueAtCreate: p.qualityIssue,
          })),
        },
        discrepancies: {
          create: discrepancyIds.map((id) => ({ discrepancyId: id })),
        },
      },
    });

    this.logger.log(`Inventory adjustment created: ${adjustmentNumber}`);
    return this.findOne(created.id, scope);
  }

  // ---------- approve / reject (WH Manager) ----------

  async approve(
    id: string,
    dto: ApproveInventoryAdjustmentDto,
    scope: WarehouseScope,
  ) {
    const a = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: {
        warehouse: { select: { oracleId: true } },
        class: { select: { oracleId: true } },
        createdBy: { select: { department: { select: { oracleId: true } } } },
        items: { include: { material: { select: { erpDocId: true } } } },
        discrepancies: {
          include: { discrepancy: { select: { discrepancyId: true } } },
        },
      },
    });
    if (
      !a ||
      (scope.role !== 'admin' && a.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Inventory adjustment ${id} not found`);
    }
    if (a.status !== 'PendingApproval') {
      throw new BadRequestException(
        'This adjustment has already been processed',
      );
    }

    const reason = dto.reason?.trim() || null;

    // Reject — no Oracle call.
    if (dto.action === 'reject') {
      if (!reason) {
        throw new BadRequestException('A reason is required to reject');
      }
      await this.prisma.inventoryAdjustment.update({
        where: { id },
        data: {
          status: 'Rejected',
          approvedById: scope.userId,
          approvedAt: new Date(),
          approvalReason: reason,
        },
      });
      this.logger.log(`Adjustment ${id} rejected by user ${scope.userId}`);
      return this.findOne(id, scope);
    }

    // Approve — post to Oracle FIRST. If it fails, nothing is committed (stays
    // Pending Approval) so the user can retry.
    const oracle = await this.postToOracle(a);

    await this.prisma.inventoryAdjustment.update({
      where: { id },
      data: {
        status: 'Approved',
        approvedById: scope.userId,
        approvedAt: new Date(),
        approvalReason: reason,
        oracleApprovalStatus: 'Pending Approval Oracle',
        oracleId: String(oracle.inventoryAdjustmentId),
      },
    });

    this.logger.log(
      `Adjustment ${id} approved by user ${scope.userId}; Oracle IA ${oracle.inventoryAdjustmentId}`,
    );
    const detail = await this.findOne(id, scope);
    return {
      ...detail,
      oracle: {
        message: oracle.message,
        inventory_adjustment_id: oracle.inventoryAdjustmentId,
      },
    };
  }

  // Build the Oracle Inventory Adjustment payload and POST it. Throws (503) with
  // the bridge message on any failure so the caller can surface a retry.
  private async postToOracle(a: {
    warehouse: { oracleId: string | null } | null;
    class: { oracleId: string } | null;
    createdBy: { department: { oracleId: string } | null } | null;
    note: string | null;
    adjustmentType: string;
    items: {
      qtyAdjustment: number;
      qtyPassed: number;
      material: { erpDocId: string | null } | null;
    }[];
    discrepancies: { discrepancy: { discrepancyId: string } }[];
  }): Promise<{ inventoryAdjustmentId: number; message: string }> {
    const locationOracle = a.warehouse?.oracleId;
    const classOracle = a.class?.oracleId;
    const deptOracle = a.createdBy?.department?.oracleId;

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
    const isQty = a.adjustmentType === 'qty_issue';

    // Group lines by item (erp_doc_id) so multiple bins of the same material go
    // out as ONE line with the summed quantity (Oracle expects one line/item).
    const qtyByItem = new Map<number, number>();
    for (const it of a.items) {
      const item = Number(it.material?.erpDocId);
      if (!Number.isFinite(item)) continue;
      const q = isQty ? it.qtyAdjustment : it.qtyPassed;
      qtyByItem.set(item, (qtyByItem.get(item) ?? 0) + q);
    }
    const lines = [...qtyByItem.entries()]
      .map(([item, quantity]) => ({ item, location, quantity, department }))
      .filter((l) => l.quantity !== 0);
    if (lines.length === 0) {
      throw new BadRequestException(
        'No postable lines (missing item erp id or zero quantity)',
      );
    }

    const memo = a.discrepancies
      .map((d) => d.discrepancy.discrepancyId)
      .join(', ');

    const payload = {
      customform: ADJ_CUSTOMFORM,
      subsidiary: ADJ_SUBSIDIARY,
      account: ADJ_ACCOUNT,
      adjlocation: location,
      department,
      class: Number(classOracle),
      memo,
      custbody_me_description: a.note ?? '',
      lines,
    };

    let res: { ok: boolean; status: number; body: OracleAdjustmentResponse | null };
    try {
      res = await this.erp.postRaw<OracleAdjustmentResponse>(
        '/inventory/adjustments',
        payload,
      );
    } catch (e) {
      throw new ServiceUnavailableException(
        `Failed to reach Oracle Inventory Adjustment: ${(e as Error).message}`,
      );
    }

    const body = res.body;
    const invId = body?.inventory_adjustment_id;
    const ok =
      (body?.status === 'success' || body?.success === true) && invId != null;
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

  // ---------- read ----------

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      adjustment_type?: string;
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

    const where: Prisma.InventoryAdjustmentWhereInput = {
      ...this.scopeWhere(scope),
    };
    if (
      query.adjustment_type === 'qty_issue' ||
      query.adjustment_type === 'quality_issue'
    ) {
      where.adjustmentType = query.adjustment_type;
    }
    if (query.search) {
      where.adjustmentNumber = {
        contains: query.search,
        mode: 'insensitive',
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryAdjustment.count({ where }),
      this.prisma.inventoryAdjustment.findMany({
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
    const a = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (
      !a ||
      (scope.role !== 'admin' && a.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Inventory adjustment ${id} not found`);
    }
    return this.serializeDetail(a);
  }

  // ---------- serializers ----------

  private lineQty(a: { adjustmentType: string }, it: {
    qtyAdjustment: number;
    qtyScrapped: number;
    qtyPassed: number;
  }) {
    return a.adjustmentType === 'qty_issue'
      ? it.qtyAdjustment
      : it.qtyScrapped + it.qtyPassed;
  }

  private serializeList(a: AdjList) {
    const materials = new Set(a.items.map((it) => it.materialId ?? it.materialCode));
    const bins = new Set(a.items.map((it) => it.binId ?? it.binLabel));
    const totalQty = a.items.reduce((s, it) => s + this.lineQty(a, it), 0);
    return {
      id: a.id,
      adjustment_number: a.adjustmentNumber,
      warehouse: a.warehouse?.name ?? null,
      adjustment_type: a.adjustmentType,
      status: a.status,
      material_count: materials.size,
      bin_count: bins.size,
      total_qty: totalQty,
      discrepancy_count: a._count.discrepancies,
      oracle_id: a.oracleId,
      oracle_approval_status: a.oracleApprovalStatus,
      created_by: a.createdBy?.name ?? null,
      created_at: a.createdAt,
    };
  }

  private serializeDetail(a: AdjDetail) {
    return {
      id: a.id,
      adjustment_number: a.adjustmentNumber,
      warehouse: a.warehouse?.name ?? null,
      warehouse_id: a.warehouseId,
      class_id: a.classId,
      class_name: a.class?.name ?? null,
      class_oracle_id: a.class?.oracleId ?? null,
      adjustment_type: a.adjustmentType,
      status: a.status,
      note: a.note,
      oracle_id: a.oracleId,
      created_by: a.createdBy?.name ?? null,
      created_at: a.createdAt,
      approved_by: a.approvedBy?.name ?? null,
      approved_at: a.approvedAt,
      approval_reason: a.approvalReason,
      oracle_approval_status: a.oracleApprovalStatus,
      total_qty: a.items.reduce((s, it) => s + this.lineQty(a, it), 0),
      items: a.items.map((it) => ({
        id: it.id,
        material_id: it.materialId,
        material_code: it.materialCode,
        material_name: it.materialName,
        bin_id: it.binId,
        bin_label: it.binLabel ?? it.bin?.binLabel ?? null,
        qty_adjustment: it.qtyAdjustment,
        qty_scrapped: it.qtyScrapped,
        qty_passed: it.qtyPassed,
        avail_at_create: it.availAtCreate,
        qty_issue_at_create: it.qtyIssueAtCreate,
        quality_issue_at_create: it.qualityIssueAtCreate,
      })),
      discrepancies: a.discrepancies.map((d) => ({
        id: d.discrepancy.id,
        discrepancy_id: d.discrepancy.discrepancyId,
        type: d.discrepancy.discrepancyType,
        from: d.discrepancy.discrepancyFrom,
      })),
    };
  }
}
