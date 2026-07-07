import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import type { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import type { ApproveInventoryAdjustmentDto } from './dto/approve-inventory-adjustment.dto';

export interface WarehouseScope {
  userId: number;
  role: string;
  warehouseId: string | null;
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
  warehouse: (d) => ({ warehouse: { name: d } }),
  created_by: (d) => ({ createdBy: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
};

@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(private prisma: PrismaService) {}

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
        if (!(qtyAdjustment > 0)) {
          throw new BadRequestException('Qty adjustment must be greater than 0');
        }
        if (qtyAdjustment > stock.availQty + 1e-9) {
          throw new BadRequestException(
            `Qty adjustment (${qtyAdjustment}) exceeds available (${stock.availQty})`,
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
      select: { id: true, status: true, warehouseId: true },
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
    if (dto.action === 'reject' && !reason) {
      throw new BadRequestException('A reason is required to reject');
    }

    await this.prisma.inventoryAdjustment.update({
      where: { id },
      data: {
        status: dto.action === 'approve' ? 'Approved' : 'Rejected',
        approvedById: scope.userId,
        approvedAt: new Date(),
        approvalReason: reason,
        // Approving in WMS hands off to Oracle; reject leaves it untouched ("-").
        ...(dto.action === 'approve'
          ? { oracleApprovalStatus: 'Pending Approval Oracle' }
          : {}),
      },
    });

    this.logger.log(
      `Adjustment ${id} ${dto.action}ed by user ${scope.userId}`,
    );
    return this.findOne(id, scope);
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
      adjustment_type: a.adjustmentType,
      status: a.status,
      note: a.note,
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
