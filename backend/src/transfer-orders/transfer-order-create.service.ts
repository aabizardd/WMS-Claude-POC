import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErpHttpService } from '../erp/erp-http.service';
import { TransferOrderSyncService, type OracleTransferOrder } from './transfer-order-sync.service';
import { assignOutboundId } from '../common/outbound-id';
import { paginationMeta } from '../common/pagination';
import { subsidiaryListOr, subsidiarySingleFilter } from '../common/subsidiary-filter';
import { usableBinStockWhere } from '../common/frozen-bins';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { CreateTransferOrderDto } from './dto/create-transfer-order.dto';
import type { QueryToStockItemsDto } from './dto/query-to-stock-items.dto';
import type { ResolveToItemsDto } from './dto/resolve-to-items.dto';

const EPS = 1e-9;

/** Fixed parts of every Transfer Order WMS creates (agreed with Oracle). */
const TO_FIXED = {
  customform: 135,
  incoterm: 1,
  subsidiary: 6,
  firmed: false,
  useitemcostastransfercost: true,
  files: [] as unknown[],
};

/** A WMS-created TO's states before Oracle's own status takes over. */
const SYNCING = 'Syncing';
const FAILED = 'Failed';
const SYNCED = 'Synced';
/** Saved in WMS only, still editable; Submit sends it to Oracle. */
export const DRAFT = 'Draft';
/** Oracle's status for a TO its approver turned down: it can be cloned. */
const REJECTED = 'Rejected';
/** Oracle's first status for a new TO. */
const PENDING_APPROVAL = 'Pending Approval';

/** The Oracle create request as stored on the TO (trandate is added on send). */
interface CreateToPayload {
  memo: string;
  class: number;
  files: unknown[];
  items: { item: number; quantity: number; description: string }[];
  firmed: boolean;
  incoterm: number;
  location: number;
  customform: number;
  department: number;
  subsidiary: number;
  transferlocation: number;
  useitemcostastransfercost: boolean;
  custbody_msi_createdby_api: string;
  note_approval: string;
}

/** Form defaults: Oracle class / department internal ids. */
const DEFAULT_CLASS_ORACLE_ID = '3';
const DEFAULT_DEPARTMENT_ORACLE_ID = '3';

interface OracleCreateToResponse {
  success?: boolean;
  status?: string;
  message?: string;
  id?: number | string;
  tranid?: string;
  transfer_order_id?: number | string;
  data?: {
    id?: number | string;
    internal_id?: number | string;
    tranid?: string;
    tran_id?: string;
    transfer_order_id?: number | string;
  } | null;
}

/** Today in WIB as Oracle's "DD/MM/YYYY". */
export function wibTranDate(now = new Date()): string {
  const t = new Date(now.getTime() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** The new TO's Oracle id and number, wherever the bridge puts them. */
export function readCreatedTo(body: OracleCreateToResponse | null) {
  const d = body?.data ?? null;
  const id = d?.id ?? d?.internal_id ?? d?.transfer_order_id ?? body?.transfer_order_id ?? body?.id;
  const tranId = d?.tranid ?? d?.tran_id ?? body?.tranid;
  return {
    oracleId: id != null && String(id).trim() !== '' ? String(id) : null,
    tranId: tranId ? String(tranId) : null,
  };
}

/**
 * Create Transfer Order (from the TO In and TO Out lists). The TO is saved in
 * WMS as Syncing and sent to Oracle (transfer-orders/create) in the
 * background: Pending Approval once Oracle accepts it, Failed when it does
 * not (then Retry). One sender per TO at a time (a lock on the row), and a
 * retry after an unanswered attempt looks for it in Oracle before sending.
 */
/** Billing warehouses (any case) are never offered as a TO's sending warehouse. */
export const isBillingWarehouse = (name: string) => /billing/i.test(name);

@Injectable()
export class TransferOrderCreateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TransferOrderCreateService.name);

  constructor(
    private prisma: PrismaService,
    private erp: ErpHttpService,
    private toSync: TransferOrderSyncService,
  ) {}

  /**
   * The receiving warehouses the user may pick, and the one picked first.
   * A user picks among their own warehouses (every one when they have none);
   * admin, the superuser, among every warehouse, starting on their own.
   */
  private async receivingWarehouses(user: AuthUser) {
    const own = (
      await this.prisma.userWarehouse.findMany({
        where: { userId: user.userId, warehouse: { isInactive: false } },
        select: { warehouse: { select: { id: true, name: true, oracleId: true } } },
      })
    )
      .map((o) => o.warehouse)
      .sort((a, b) => a.name.localeCompare(b.name));
    const options =
      own.length && user.role !== 'admin'
        ? own
        : await this.prisma.warehouse.findMany({
            where: { isInactive: false, subsidiaryId: subsidiarySingleFilter() },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, oracleId: true },
          });
    // Admin's header warehouse, else their own, else the first offered.
    const preferred = [...(user.warehouseIds ?? []), ...own.map((w) => w.id)];
    const defaultId = preferred.find((id) => options.some((o) => o.id === id)) ?? options[0]?.id ?? null;
    return { options, defaultId };
  }

  /** Dropdowns and defaults for the Create TO form. */
  async formOptions(user: AuthUser) {
    const [me, classes, departments, fromWarehouses, toWarehouses] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } }),
      this.prisma.class.findMany({
        where: { isInactive: false, AND: [{ OR: subsidiaryListOr('subsidiaryId') }] },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, oracleId: true },
      }),
      this.prisma.department.findMany({
        where: { isInactive: false, AND: [{ OR: subsidiaryListOr('subsidiaryId') }] },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, oracleId: true },
      }),
      this.prisma.warehouse.findMany({
        where: {
          isInactive: false,
          subsidiaryId: subsidiarySingleFilter(),
          // Billing warehouses hold no physical stock to send.
          NOT: { name: { contains: 'billing', mode: 'insensitive' } },
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, oracleId: true },
      }),
      this.receivingWarehouses(user),
    ]);
    return {
      created_by_name: me?.name ?? user.username,
      classes,
      departments,
      from_warehouses: fromWarehouses,
      to_warehouses: toWarehouses.options,
      default_class_id: classes.find((c) => c.oracleId === DEFAULT_CLASS_ORACLE_ID)?.id ?? null,
      default_department_id:
        departments.find((d) => d.oracleId === DEFAULT_DEPARTMENT_ORACLE_ID)?.id ?? null,
      default_to_warehouse_id: toWarehouses.defaultId,
    };
  }

  /** Bin stock that can leave a warehouse: placed, available, not frozen (KIT). */
  private transferableStock() {
    return { binId: { not: null }, availQty: { gt: 0 }, ...usableBinStockWhere() };
  }

  /** One page of the materials the sending warehouse has available to transfer. */
  async stockItems(query: QueryToStockItemsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const wh = await this.prisma.warehouse.findUnique({
      where: { id: query.warehouse_id },
      select: { id: true },
    });
    if (!wh) throw new NotFoundException('Sending warehouse not found');

    const search = query.search?.trim();
    const where = {
      warehouseId: wh.id,
      // Oracle needs the item's internal id.
      material: {
        erpDocId: { not: null },
        ...(search
          ? {
              OR: [
                { materialCode: { contains: search, mode: 'insensitive' as const } },
                { materialName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      binStocks: { some: this.transferableStock() },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryManagement.count({ where }),
      this.prisma.inventoryManagement.findMany({
        where,
        orderBy: [{ materialCode: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          materialId: true,
          materialCode: true,
          material: {
            select: {
              materialCode: true,
              materialName: true,
              erpDocId: true,
              primaryUom: { select: { uomCode: true, allowsDecimal: true } },
            },
          },
          binStocks: { where: this.transferableStock(), select: { availQty: true } },
        },
      }),
    ]);
    return {
      ...paginationMeta(total, page, limit, {}),
      rows: rows.map((r) => ({
        material_id: r.materialId,
        material_code: r.material?.materialCode ?? r.materialCode,
        material_name: r.material?.materialName ?? null,
        erp_item_id: r.material?.erpDocId ?? null,
        uom_code: r.material?.primaryUom?.uomCode ?? null,
        allows_decimal: r.material?.primaryUom?.allowsDecimal ?? true,
        qty_available: r.binStocks.reduce((s, b) => s + b.availQty, 0),
      })),
    };
  }

  /**
   * Quick Add: look pasted Part Numbers up in the Material Master and in the
   * sending warehouse's transferable stock. A PN matches a material code
   * exactly (any case), or the code part of one written "CODE - NAME". Each
   * distinct PN comes back once, with why it cannot be added if so.
   */
  async resolveItems(dto: ResolveToItemsDto) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouse_id }, select: { id: true, name: true } });
    if (!wh) throw new NotFoundException('Sending warehouse not found');
    const codes = [...new Map(dto.codes.map((c) => [c.trim().toLowerCase(), c.trim()])).values()].filter(Boolean);
    if (!codes.length) return { rows: [] };

    const mats = await this.prisma.material.findMany({
      where: {
        OR: codes.flatMap((c) => [
          { materialCode: { equals: c, mode: 'insensitive' as const } },
          { materialCode: { startsWith: `${c} - `, mode: 'insensitive' as const } },
        ]),
      },
      select: {
        id: true,
        materialCode: true,
        materialName: true,
        erpDocId: true,
        primaryUom: { select: { uomCode: true, allowsDecimal: true } },
      },
    });
    const stock = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId: wh.id, materialId: { in: mats.map((m) => m.id) } },
      select: { materialId: true, binStocks: { where: this.transferableStock(), select: { availQty: true } } },
    });
    const availById = new Map<string, number>();
    for (const inv of stock) {
      if (!inv.materialId) continue;
      availById.set(inv.materialId, (availById.get(inv.materialId) ?? 0) + inv.binStocks.reduce((s, b) => s + b.availQty, 0));
    }

    const rows = codes.map((code) => {
      const lower = code.toLowerCase();
      // An exact code wins over "CODE - NAME".
      const material =
        mats.find((m) => m.materialCode.toLowerCase() === lower) ??
        mats.find((m) => m.materialCode.toLowerCase().startsWith(`${lower} - `));
      if (!material) return { code, status: 'not_found' as const, item: null };
      const available = availById.get(material.id) ?? 0;
      const item = {
        material_id: material.id,
        material_code: material.materialCode,
        material_name: material.materialName,
        erp_item_id: material.erpDocId,
        uom_code: material.primaryUom?.uomCode ?? null,
        allows_decimal: material.primaryUom?.allowsDecimal ?? true,
        qty_available: available,
      };
      if (!material.erpDocId) return { code, status: 'no_erp_id' as const, item };
      if (available <= EPS) return { code, status: 'no_stock' as const, item };
      return { code, status: 'ok' as const, item };
    });
    return { warehouse: wh.name, rows };
  }

  /**
   * Check a Create / Edit TO form against today's master data and stock, and
   * build the Oracle request and the TO's lines from it. Run on every save
   * (Draft or not) and again on Submit: stock may have moved meanwhile.
   */
  private async prepare(dto: CreateTransferOrderDto, user: AuthUser) {
    if (dto.from_warehouse_id === dto.to_warehouse_id) {
      throw new BadRequestException('The sending and receiving warehouse must be different');
    }
    const [from, to, klass, department, me, receivable] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: dto.from_warehouse_id } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.to_warehouse_id } }),
      this.prisma.class.findUnique({ where: { id: dto.class_id } }),
      this.prisma.department.findUnique({ where: { id: dto.department_id } }),
      this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } }),
      this.receivingWarehouses(user),
    ]);
    if (!from || from.isInactive) throw new BadRequestException('Sending warehouse not found');
    if (isBillingWarehouse(from.name)) {
      throw new BadRequestException(`"${from.name}" is a billing warehouse and cannot send a Transfer Order`);
    }
    if (!to || to.isInactive) throw new BadRequestException('Receiving warehouse not found');
    if (!receivable.options.some((w) => w.id === to.id)) {
      throw new BadRequestException(`"${to.name}" is not one of your warehouses`);
    }
    if (!klass) throw new BadRequestException('Selected class does not exist');
    if (!department) throw new BadRequestException('Selected department does not exist');

    // Every line: a material the sending warehouse has. The same material may
    // sit on several lines (kept apart, never merged); together they stay
    // within its available qty.
    const ids = [...new Set(dto.items.map((i) => i.material_id))];
    const invs = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId: from.id, materialId: { in: ids } },
      select: {
        materialId: true,
        material: {
          select: {
            materialCode: true,
            erpDocId: true,
            primaryUom: { select: { allowsDecimal: true } },
          },
        },
        binStocks: { where: this.transferableStock(), select: { availQty: true } },
      },
    });
    // A material can sit on more than one inventory row (an old code kept
    // after a rename): what it has available is the sum of them.
    const availByMaterial = new Map<string, number>();
    const materialById = new Map<string, NonNullable<(typeof invs)[number]['material']>>();
    for (const inv of invs) {
      if (!inv.materialId || !inv.material) continue;
      materialById.set(inv.materialId, inv.material);
      const avail = inv.binStocks.reduce((s, b) => s + b.availQty, 0);
      availByMaterial.set(inv.materialId, (availByMaterial.get(inv.materialId) ?? 0) + avail);
    }
    const requestedByMaterial = new Map<string, number>();
    for (const row of dto.items) {
      requestedByMaterial.set(row.material_id, (requestedByMaterial.get(row.material_id) ?? 0) + row.quantity);
    }
    const items = dto.items.map((row) => {
      const material = materialById.get(row.material_id);
      if (!material) {
        throw new BadRequestException(`A selected material has no stock in "${from.name}"`);
      }
      const label = material.materialCode;
      const erpId = Number(material.erpDocId);
      if (!material.erpDocId || !Number.isFinite(erpId)) {
        throw new BadRequestException(`${label} has no ERP item id — sync the material from ERP first`);
      }
      if (material.primaryUom?.allowsDecimal === false && !Number.isInteger(row.quantity)) {
        throw new BadRequestException(`${label}: the quantity must be a whole number`);
      }
      const available = availByMaterial.get(row.material_id) ?? 0;
      const requested = requestedByMaterial.get(row.material_id) ?? 0;
      if (requested > available + EPS) {
        throw new BadRequestException(
          `${label}: Qty Request (${requested}${requested !== row.quantity ? ', all its rows together' : ''}) exceeds the available qty (${available}) in "${from.name}"`,
        );
      }
      return { item: erpId, quantity: row.quantity, description: row.description?.trim() ?? '' };
    });

    const payload: CreateToPayload = {
      memo: dto.memo?.trim() ?? '',
      class: Number(klass.oracleId),
      files: TO_FIXED.files,
      items,
      firmed: TO_FIXED.firmed,
      incoterm: TO_FIXED.incoterm,
      location: Number(from.oracleId),
      customform: TO_FIXED.customform,
      department: Number(department.oracleId),
      subsidiary: TO_FIXED.subsidiary,
      transferlocation: Number(to.oracleId),
      useitemcostastransfercost: TO_FIXED.useitemcostastransfercost,
      custbody_msi_createdby_api: me?.name ?? user.username,
      note_approval: dto.note_approval?.trim() ?? '',
    };

    const lines = dto.items.map((row, i) => {
      const material = materialById.get(row.material_id)!;
      return {
        lineNumber: i + 1,
        itemOracleId: material.erpDocId,
        itemName: material.materialCode,
        description: row.description?.trim() || null,
        quantity: row.quantity,
        materialId: row.material_id,
      };
    });
    return { from, to, klass, department, me, payload, lines };
  }

  /** The TO header a Create / Edit form saves (any status). */
  private headerData(p: Awaited<ReturnType<TransferOrderCreateService['prepare']>>, dto: CreateTransferOrderDto) {
    return {
      memo: p.payload.memo || null,
      noteApproval: dto.note_approval?.trim() || null,
      classId: p.klass.id,
      departmentId: p.department.id,
      fromLocationOracleId: p.from.oracleId,
      fromLocationName: p.from.name,
      warehouseId: p.from.id,
      toLocationOracleId: p.to.oracleId,
      toLocationName: p.to.name,
      toWarehouseId: p.to.id,
    };
  }

  /** Submitted: Syncing, sent to Oracle in the background. */
  private sendingData(payload: CreateToPayload) {
    return {
      statusName: SYNCING,
      syncStatus: SYNCING,
      syncStartedAt: new Date(),
      syncError: null,
      createPayload: payload as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Save a new TO: as a Draft (stays in WMS, still editable) or submitted
   * (Syncing; Oracle is called in the background).
   */
  async create(dto: CreateTransferOrderDto, user: AuthUser) {
    const p = await this.prepare(dto, user);
    const draft = dto.draft === true;
    const created = await this.prisma.transferOrder.create({
      data: {
        source: 'WMS',
        ...(draft ? { statusName: DRAFT } : this.sendingData(p.payload)),
        createdById: user.userId,
        createdBy: p.me?.name ?? user.username,
        ...this.headerData(p, dto),
        items: { create: p.lines },
      },
    });
    await assignOutboundId(this.prisma, 'TO', created.id, created.createdAt);
    this.logger.log(
      `Transfer Order ${created.id} saved (${draft ? DRAFT : SYNCING}) by ${user.username}: ${p.from.name} → ${p.to.name}, ${p.lines.length} line(s)`,
    );
    if (!draft) this.dispatchLater(created.id);
    return { id: created.id, status_name: draft ? DRAFT : SYNCING };
  }

  /** Who may edit, submit or delete a Draft: its creator, or a user of its sending warehouse. */
  private draftAccess(user: AuthUser): Prisma.TransferOrderWhereInput {
    if (!user.warehouseIds) return {};
    return { OR: [{ createdById: user.userId }, { warehouseId: { in: user.warehouseIds } }] };
  }

  private async findDraft(id: string, user: AuthUser) {
    const to = await this.prisma.transferOrder.findFirst({
      where: { id, source: 'WMS', ...this.draftAccess(user) },
      include: { items: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!to) throw new NotFoundException(`Transfer order ${id} not found`);
    if (to.statusName !== DRAFT) {
      throw new ConflictException(`This Transfer Order is ${to.statusName ?? 'not a draft'} — only a Draft can be changed`);
    }
    return to;
  }

  /**
   * Edit a Draft: its header and lines are replaced by the form's. With
   * `draft: false` it is submitted right after (Syncing).
   */
  async updateDraft(id: string, dto: CreateTransferOrderDto, user: AuthUser) {
    await this.findDraft(id, user);
    const p = await this.prepare(dto, user);
    const submit = dto.draft === false;
    await this.prisma.$transaction(async (tx) => {
      // Still a Draft (a submit from another tab wins).
      const { count } = await tx.transferOrder.updateMany({
        where: { id, statusName: DRAFT },
        data: { ...this.headerData(p, dto), ...(submit ? this.sendingData(p.payload) : {}) },
      });
      if (!count) throw new ConflictException('This Transfer Order is no longer a Draft');
      await tx.transferOrderItem.deleteMany({ where: { transferOrderId: id } });
      await tx.transferOrderItem.createMany({ data: p.lines.map((l) => ({ ...l, transferOrderId: id })) });
    });
    this.logger.log(`Transfer Order ${id} draft ${submit ? 'saved and submitted' : 'updated'} by ${user.username}`);
    if (submit) this.dispatchLater(id);
    return { id, status_name: submit ? SYNCING : DRAFT };
  }

  /** The form a stored TO fills in (its header and lines as saved). */
  private formOf(to: Prisma.TransferOrderGetPayload<{ include: { items: true } }>): CreateTransferOrderDto {
    return {
      memo: to.memo ?? '',
      note_approval: to.noteApproval ?? '',
      class_id: to.classId ?? '',
      department_id: to.departmentId ?? '',
      from_warehouse_id: to.warehouseId ?? '',
      to_warehouse_id: to.toWarehouseId ?? '',
      items: to.items
        .filter((l) => l.materialId)
        .map((l) => ({ material_id: l.materialId!, quantity: l.quantity, description: l.description ?? undefined })),
    };
  }

  /** Submit a Draft as it is saved: checked again, then sent to Oracle. */
  async submitDraft(id: string, user: AuthUser) {
    const to = await this.findDraft(id, user);
    const dto = this.formOf(to);
    if (!dto.class_id || !dto.department_id) throw new BadRequestException('Fill in the Class and Department first (Edit)');
    if (!dto.items.length) throw new BadRequestException('Add at least one item first (Edit)');
    const p = await this.prepare(dto, user);
    const { count } = await this.prisma.transferOrder.updateMany({
      where: { id, statusName: DRAFT },
      data: this.sendingData(p.payload),
    });
    if (!count) throw new ConflictException('This Transfer Order is no longer a Draft');
    this.logger.log(`Transfer Order ${id} draft submitted by ${user.username}`);
    this.dispatchLater(id);
    return { id, status_name: SYNCING };
  }

  /** Delete a Draft (it never reached Oracle). */
  async deleteDraft(id: string, user: AuthUser) {
    const to = await this.findDraft(id, user);
    const { count } = await this.prisma.transferOrder.deleteMany({ where: { id, statusName: DRAFT } });
    if (!count) throw new ConflictException('This Transfer Order is no longer a Draft');
    this.logger.log(`Transfer Order draft ${to.outboundId ?? id} deleted by ${user.username}`);
    return { id, deleted: true };
  }

  /**
   * A saved TO as Create TO form data: a Draft to edit, or a Rejected TO to
   * clone (header, lines, qty and descriptions as they were). Each line comes
   * with today's available qty in the sending warehouse; a line whose
   * material is unknown to WMS is left out and listed in `skipped`.
   */
  async formData(id: string, purpose: 'edit' | 'clone', user: AuthUser) {
    let to: Prisma.TransferOrderGetPayload<{ include: { items: true } }>;
    if (purpose === 'edit') {
      to = await this.findDraft(id, user);
    } else {
      const found = await this.prisma.transferOrder.findFirst({
        where: { id, ...this.visibleTo(user) },
        include: { items: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!found) throw new NotFoundException(`Transfer order ${id} not found`);
      if (found.statusName !== REJECTED) {
        throw new ConflictException(`Only a Rejected Transfer Order can be cloned (this one is ${found.statusName ?? '—'})`);
      }
      to = found;
    }

    const materialIds = [...new Set(to.items.map((l) => l.materialId).filter((m): m is string => !!m))];
    const [mats, stock] = await Promise.all([
      this.prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: {
          id: true,
          materialCode: true,
          materialName: true,
          erpDocId: true,
          primaryUom: { select: { uomCode: true, allowsDecimal: true } },
        },
      }),
      to.warehouseId
        ? this.prisma.inventoryManagement.findMany({
            where: { warehouseId: to.warehouseId, materialId: { in: materialIds } },
            select: { materialId: true, binStocks: { where: this.transferableStock(), select: { availQty: true } } },
          })
        : Promise.resolve([]),
    ]);
    const matById = new Map(mats.map((m) => [m.id, m]));
    const availById = new Map<string, number>();
    for (const inv of stock) {
      if (!inv.materialId) continue;
      availById.set(inv.materialId, (availById.get(inv.materialId) ?? 0) + inv.binStocks.reduce((s, b) => s + b.availQty, 0));
    }

    const skipped: string[] = [];
    const items = to.items.flatMap((l) => {
      const m = l.materialId ? matById.get(l.materialId) : undefined;
      if (!m) {
        skipped.push(l.itemName ?? `Line ${l.lineNumber}`);
        return [];
      }
      return [
        {
          item: {
            material_id: m.id,
            material_code: m.materialCode,
            material_name: m.materialName,
            erp_item_id: m.erpDocId,
            uom_code: m.primaryUom?.uomCode ?? null,
            allows_decimal: m.primaryUom?.allowsDecimal ?? true,
            qty_available: availById.get(m.id) ?? 0,
          },
          quantity: l.quantity,
          description: l.description ?? '',
        },
      ];
    });

    return {
      id: to.id,
      purpose,
      status_name: to.statusName,
      outbound_id: to.outboundId,
      tran_id: to.tranId,
      from_warehouse_id: to.warehouseId,
      to_warehouse_id: to.toWarehouseId,
      // Oracle's TO carries no class / department: the form's defaults then.
      class_id: to.classId,
      department_id: to.departmentId,
      memo: to.memo ?? '',
      note_approval: to.noteApproval ?? '',
      items,
      skipped,
    };
  }

  /** Send a Failed TO to Oracle again (in the background, like Create). */
  async retry(id: string, user: AuthUser) {
    const to = await this.prisma.transferOrder.findFirst({
      where: { id, source: 'WMS', ...this.visibleTo(user) },
      select: { id: true, syncStatus: true },
    });
    if (!to) throw new NotFoundException(`Transfer order ${id} not found`);
    // Only from Failed — a second click or a TO already on its way is refused.
    const { count } = await this.prisma.transferOrder.updateMany({
      where: { id, syncStatus: FAILED },
      data: { syncStatus: SYNCING, statusName: SYNCING, syncError: null },
    });
    if (!count) {
      throw new ConflictException(`This Transfer Order is ${to.syncStatus ?? 'not failed'} — nothing to retry`);
    }
    this.logger.log(`Transfer Order ${id} retry requested by ${user.username}`);
    this.dispatchLater(id);
    return { id, status_name: SYNCING };
  }

  /** The creator, or a user of its sending / receiving warehouse. */
  private visibleTo(user: AuthUser): Prisma.TransferOrderWhereInput {
    if (!user.warehouseIds) return {};
    return {
      OR: [
        { createdById: user.userId },
        { warehouseId: { in: user.warehouseIds } },
        { toWarehouseId: { in: user.warehouseIds } },
      ],
    };
  }

  /**
   * After a restart nothing is sending: a TO that was mid-send may or may not
   * be in Oracle, so it turns Failed (its retry looks in Oracle first); one
   * that never got to send is sent now.
   */
  async onApplicationBootstrap() {
    try {
      const interrupted = await this.prisma.transferOrder.updateMany({
        where: { source: 'WMS', syncStatus: SYNCING, syncLock: { not: null } },
        data: {
          syncStatus: FAILED,
          statusName: FAILED,
          syncLock: null,
          syncUncertain: true,
          syncError: 'Interrupted (the server restarted while sending to Oracle). Retry checks Oracle first.',
        },
      });
      if (interrupted.count) {
        this.logger.warn(`${interrupted.count} Transfer Order(s) interrupted mid-send marked Failed`);
      }
      const waiting = await this.prisma.transferOrder.findMany({
        where: { source: 'WMS', syncStatus: SYNCING, syncLock: null },
        select: { id: true },
      });
      waiting.forEach((t) => this.dispatchLater(t.id));
    } catch (e) {
      this.logger.error(`Create TO recovery failed: ${(e as Error).message}`);
    }
  }

  private dispatchLater(id: string) {
    setImmediate(() => {
      this.dispatch(id).catch((e) =>
        this.logger.error(`[CreateTO] ${id} background send crashed: ${(e as Error).message}`),
      );
    });
  }

  /** The background send of one TO. */
  async dispatch(id: string) {
    // Claim it: only one sender per TO, ever at once.
    const lock = randomUUID();
    const { count } = await this.prisma.transferOrder.updateMany({
      where: { id, syncStatus: SYNCING, syncLock: null },
      data: { syncLock: lock, syncAttempts: { increment: 1 } },
    });
    if (!count) return;
    const row = await this.prisma.transferOrder.findUniqueOrThrow({ where: { id } });
    const payload = row.createPayload as unknown as CreateToPayload;

    try {
      // An earlier attempt went unanswered: it may already be in Oracle.
      if (row.syncUncertain) {
        const found = await this.findInOracle(row.syncStartedAt ?? row.createdAt, payload);
        if (found) {
          this.logger.warn(`[CreateTO] ${id} already in Oracle as ${found.tranid ?? found.id} — not sent again`);
          await this.succeed(id, { oracleId: String(found.id), tranId: found.tranid ?? null }, found);
          return;
        }
      }

      const request = { ...payload, trandate: wibTranDate() };
      this.logger.log(`[CreateTO] ${id} REQUEST ${JSON.stringify(request)}`);
      let res: { ok: boolean; status: number; body: OracleCreateToResponse | null };
      try {
        // Not retried on a 5xx / network error: the first try may have created it.
        res = await this.erp.postRaw<OracleCreateToResponse>('/transfer-orders/create', request, {
          idempotent: false,
        });
      } catch (e) {
        await this.fail(id, lock, `Failed to reach Oracle: ${(e as Error).message}`, true);
        return;
      }
      this.logger.log(`[CreateTO] ${id} RESPONSE ${res.status} ${JSON.stringify(res.body)}`);
      const body = res.body;
      const ok = res.ok && (body?.success === true || body?.status === 'success');
      if (!ok) {
        // A 4xx is Oracle saying no; a 5xx / unreadable answer may still have created it.
        const uncertain = res.status >= 500 || body == null;
        await this.fail(id, lock, body?.message ?? `Oracle Create Transfer Order failed (HTTP ${res.status})`, uncertain);
        return;
      }

      let created = readCreatedTo(body);
      let found: OracleTransferOrder | null = null;
      if (!created.oracleId) {
        // Accepted but no id in the answer: find it by its content.
        found = await this.findInOracle(row.syncStartedAt ?? row.createdAt, payload).catch(() => null);
        if (found) created = { oracleId: String(found.id), tranId: found.tranid ?? created.tranId };
      }
      await this.succeed(id, created, found);
    } catch (e) {
      await this.fail(id, lock, `Unexpected error: ${(e as Error).message}`, true);
    }
  }

  /** Oracle has it: the TO becomes Pending Approval and takes Oracle's id and lines. */
  private async succeed(
    id: string,
    created: { oracleId: string | null; tranId: string | null },
    oracleTo: OracleTransferOrder | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // The scheduled sync may have pulled it in already as a TO of its own:
      // that copy goes, this one (the one users have open) stays.
      if (created.oracleId) {
        const twin = await tx.transferOrder.findUnique({
          where: { oracleId: created.oracleId },
          select: { id: true, _count: { select: { pickings: true } } },
        });
        if (twin && twin.id !== id) {
          if (twin._count.pickings > 0) {
            throw new Error(`Oracle TO ${created.oracleId} is already in WMS with pickings`);
          }
          await tx.transferOrder.delete({ where: { id: twin.id } });
        }
      }
      // Whatever the lock: a late answer that Oracle created it always wins.
      await tx.transferOrder.update({
        where: { id },
        data: {
          oracleId: created.oracleId,
          tranId: created.tranId,
          statusName: PENDING_APPROVAL,
          syncStatus: SYNCED,
          syncError: created.oracleId ? null : 'Created in Oracle, but its id was not returned — it is linked on the next sync.',
          syncUncertain: false,
          syncLock: null,
        },
      });
    });
    this.logger.log(`[CreateTO] ${id} created in Oracle as ${created.tranId ?? '—'} (id ${created.oracleId ?? '—'})`);

    // Oracle's own header and lines. Non-fatal: the scheduled sync catches up.
    try {
      const fresh = created.tranId ? await this.toSync.fetchOne(created.tranId) : oracleTo;
      if (fresh) await this.toSync.upsert(fresh);
    } catch (e) {
      this.logger.warn(`[CreateTO] ${id} refresh from Oracle failed: ${(e as Error).message}`);
    }
  }

  private async fail(id: string, lock: string, message: string, uncertain: boolean) {
    this.logger.error(`[CreateTO] ${id} FAILED${uncertain ? ' (may still be in Oracle)' : ''}: ${message}`);
    await this.prisma.transferOrder.updateMany({
      // Only while this attempt still holds it (a success already recorded wins).
      where: { id, syncLock: lock },
      data: {
        syncStatus: FAILED,
        statusName: FAILED,
        syncError: message,
        syncUncertain: uncertain,
        syncLock: null,
      },
    });
  }

  /** A TO in Oracle, modified since the first attempt, with this exact content. */
  private findInOracle(since: Date, payload: CreateToPayload) {
    const want = lineKey(payload.items.map((i) => [i.item, i.quantity]));
    return this.toSync.findRecent(
      new Date(since.getTime() - 5 * 60_000),
      (o) =>
        String(o.from_location_id) === String(payload.location) &&
        String(o.to_location_id) === String(payload.transferlocation) &&
        (o.memo ?? '').trim() === payload.memo &&
        lineKey((o.items ?? []).map((i) => [i.item_id, i.quantity])) === want,
    );
  }
}

/** A TO's lines as a comparable key: item:qty, sorted. */
export function lineKey(lines: [unknown, unknown][]) {
  return lines
    .map(([item, qty]) => `${String(item)}:${Number(qty)}`)
    .sort()
    .join('|');
}
