import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SalesDeliveryDocumentType,
  SalesDeliveryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';
import { isFrozenBinLabel, usableBinStockWhere } from '../common/frozen-bins';
import {
  SALES_DELIVERY_DATE_FIELDS,
  SALES_DELIVERY_ITEM_FIELDS,
  type SalesDeliveryFilterDto,
} from './dto/query-sales-delivery.dto';
import type { CreateSalesDeliveryDto } from './dto/create-sales-delivery.dto';
import type { QuerySalesDeliveryDto } from './dto/query-sales-delivery.dto';

export interface WarehouseScope {
  userId: number;
  role: string;
  warehouseId: string | null;
}

const EPS = 1e-9;

/**
 * A Sales Return is raised FROM a billing warehouse. The marker is a naming
 * convention, so it is configurable rather than hard-coded.
 */
export const BILLING_WAREHOUSE_MARKER = (
  process.env.BILLING_WAREHOUSE_LABEL ?? 'billing'
).trim();

function billingWarehouseWhere(): Prisma.WarehouseWhereInput {
  return { name: { contains: BILLING_WAREHOUSE_MARKER, mode: 'insensitive' } };
}

function isBillingName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().includes(BILLING_WAREHOUSE_MARKER.toLowerCase());
}

// How each header column maps to a Prisma predicate (case-insensitive contains).
const HEADER_FILTERS: Record<
  string,
  (v: string) => Prisma.SalesDeliveryWhereInput
> = {
  delivery_number: (v) => ({
    deliveryNumber: { contains: v, mode: 'insensitive' },
  }),
  document_type: (v) => ({
    documentType: Object.values(SalesDeliveryDocumentType).includes(
      v as SalesDeliveryDocumentType,
    )
      ? { equals: v as SalesDeliveryDocumentType }
      : { in: [] },
  }),
  from_warehouse: (v) => ({
    fromWarehouse: { name: { contains: v, mode: 'insensitive' } },
  }),
  to_warehouse: (v) => ({
    toWarehouse: { name: { contains: v, mode: 'insensitive' } },
  }),
  customer: (v) => ({
    customer: {
      OR: [
        { companyName: { contains: v, mode: 'insensitive' } },
        { entityId: { contains: v, mode: 'insensitive' } },
      ],
    },
  }),
  department: (v) => ({
    department: { name: { contains: v, mode: 'insensitive' } },
  }),
  class: (v) => ({ class: { name: { contains: v, mode: 'insensitive' } } }),
  memo: (v) => ({ memo: { contains: v, mode: 'insensitive' } }),
  created_by: (v) => ({
    createdBy: { name: { contains: v, mode: 'insensitive' } },
  }),
  from_warehouse_id: (v) => ({ fromWarehouseId: v }),
  // A value that is not a user id matches nothing rather than failing.
  created_by_id: (v) => ({
    createdById: /^\d+$/.test(v) ? Number(v) : -1,
  }),
};

// Item columns, matched against the document's lines.
const ITEM_FILTERS: Record<
  string,
  (v: string) => Prisma.SalesDeliveryItemWhereInput
> = {
  material_code: (v) => ({ materialCode: { contains: v, mode: 'insensitive' } }),
  material_name: (v) => ({ materialName: { contains: v, mode: 'insensitive' } }),
  bin: (v) => ({ binLabel: { contains: v, mode: 'insensitive' } }),
  remarks: (v) => ({ remarks: { contains: v, mode: 'insensitive' } }),
};

const listInclude = {
  sourceDelivery: { select: { id: true, deliveryNumber: true } },
  fromWarehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  customer: { select: { id: true, companyName: true, entityId: true } },
  department: { select: { id: true, name: true } },
  class: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: {
    include: { bin: { select: { binLabel: true, binCode: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SalesDeliveryInclude;

const detailInclude = {
  sourceDelivery: { select: { id: true, deliveryNumber: true } },
  fromWarehouse: { select: { id: true, name: true, oracleId: true } },
  toWarehouse: { select: { id: true, name: true, oracleId: true } },
  customer: { select: { id: true, companyName: true, entityId: true } },
  department: { select: { id: true, name: true, oracleId: true } },
  class: { select: { id: true, name: true, oracleId: true } },
  createdBy: { select: { id: true, name: true } },
  items: {
    include: { bin: { select: { binLabel: true, binCode: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SalesDeliveryInclude;

type SdList = Prisma.SalesDeliveryGetPayload<{ include: typeof listInclude }>;
type SdDetail = Prisma.SalesDeliveryGetPayload<{ include: typeof detailInclude }>;

type SdOrder = Prisma.SalesDeliveryOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => SdOrder> = {
  delivery_number: (d) => ({ deliveryNumber: d }),
  status: (d) => ({ status: d }),
  from_warehouse: (d) => ({ fromWarehouse: { name: d } }),
  to_warehouse: (d) => ({ toWarehouse: { name: d } }),
  department: (d) => ({ department: { name: d } }),
  class: (d) => ({ class: { name: d } }),
  customer: (d) => ({ customer: { companyName: d } }),
  created_by: (d) => ({ createdBy: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
};

// A line as accepted from the client, after server-side normalisation.
interface PreparedLine {
  materialId: string;
  materialCode: string | null;
  materialName: string | null;
  uomCode: string | null;
  binId: string;
  binLabel: string | null;
  remarks: string | null;
  qtyTransfer: number;
  avail: number;
}

@Injectable()
export class SalesDeliveryService {
  private readonly logger = new Logger(SalesDeliveryService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * From Location is freely chosen, so a document concerns a warehouse whether it
   * ships from it or to it. Non-admins additionally always see what they created
   * themselves — otherwise a transfer between two other warehouses would vanish
   * the moment it is saved.
   */
  private scopeWhere(scope: WarehouseScope): Prisma.SalesDeliveryWhereInput {
    const touches = (warehouseId: string): Prisma.SalesDeliveryWhereInput[] => [
      { fromWarehouseId: warehouseId },
      { toWarehouseId: warehouseId },
    ];
    if (scope.role === 'admin') {
      return scope.warehouseId ? { OR: touches(scope.warehouseId) } : {};
    }
    return {
      OR: [
        ...(scope.warehouseId ? touches(scope.warehouseId) : []),
        { createdById: scope.userId },
      ],
    };
  }

  private canSee(
    sd: { fromWarehouseId: string; toWarehouseId: string; createdById: number | null },
    scope: WarehouseScope,
  ): boolean {
    if (scope.role === 'admin') return true;
    return (
      sd.createdById === scope.userId ||
      (!!scope.warehouseId &&
        (sd.fromWarehouseId === scope.warehouseId || sd.toWarehouseId === scope.warehouseId))
    );
  }

  /**
   * An active warehouse of an allowed subsidiary, or a 400 naming the field.
   * A site the form may not offer may not be saved through a hand-made request
   * either.
   */
  private async activeWarehouse(id: string | undefined, field: string) {
    if (!id) throw new BadRequestException(`${field} is required`);
    const w = await this.prisma.warehouse.findFirst({
      where: { id, isInactive: false, subsidiaryId: subsidiarySingleFilter() },
      select: { id: true },
    });
    if (!w) {
      throw new BadRequestException(
        `Selected ${field} does not exist, is inactive, or belongs to another subsidiary`,
      );
    }
    return w.id;
  }

  // ---------- lookups (create form) ----------

  /**
   * Everything the header needs in one call. From and To share one warehouse list
   * (the form hides whichever one is picked on the other side); From defaults to
   * the user's warehouse and the department to the user's own — both overridable.
   */
  async formOptions(scope: WarehouseScope) {
    const [warehouses, departments, classes, user, customers] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isInactive: false, subsidiaryId: subsidiarySingleFilter() },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, oracleId: true },
      }),
      this.prisma.department.findMany({
        where: { isInactive: false },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, oracleId: true },
      }),
      this.prisma.class.findMany({
        where: { isInactive: false },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, oracleId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: scope.userId },
        select: { departmentId: true },
      }),
      this.prisma.customer.findMany({
        orderBy: { companyName: 'asc' },
        select: { id: true, companyName: true, entityId: true },
      }),
    ]);

    // Only default to values the dropdowns actually offer.
    const defaultFromWarehouseId =
      scope.warehouseId && warehouses.some((w) => w.id === scope.warehouseId)
        ? scope.warehouseId
        : null;
    const defaultDepartmentId =
      user?.departmentId && departments.some((d) => d.id === user.departmentId)
        ? user.departmentId
        : null;

    return {
      warehouse_options: warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        oracle_id: w.oracleId,
      })),
      department_options: departments.map((d) => ({
        id: d.id,
        name: d.name,
        oracle_id: d.oracleId,
      })),
      class_options: classes.map((c) => ({
        id: c.id,
        name: c.name,
        oracle_id: c.oracleId,
      })),
      // A return is raised FROM one of these.
      billing_warehouse_options: warehouses
        .filter((w) => isBillingName(w.name))
        .map((w) => ({ id: w.id, name: w.name, oracle_id: w.oracleId })),
      customer_options: customers.map((c) => ({
        id: c.id,
        name: c.companyName,
        entity_id: c.entityId,
      })),
      default_from_warehouse_id: defaultFromWarehouseId,
      default_department_id: defaultDepartmentId,
    };
  }

  /** Materials in the chosen From warehouse that still have stock in some bin. */
  async materialOptions(fromWarehouseId: string) {
    const warehouseId = await this.activeWarehouse(fromWarehouseId, 'From Location');

    const invs = await this.prisma.inventoryManagement.findMany({
      where: {
        warehouseId,
        materialId: { not: null },
        binStocks: {
          some: {
            binId: { not: null },
            availQty: { gt: 0 },
            // Frozen (KIT) stock cannot be transferred out.
            ...usableBinStockWhere(),
          },
        },
      },
      select: {
        materialId: true,
        materialCode: true,
        material: {
          select: {
            materialName: true,
            primaryUom: { select: { uomCode: true, allowsDecimal: true } },
          },
        },
        // Same bins the bin picker offers, summed for the "X available" badge.
        binStocks: {
          where: {
            binId: { not: null },
            availQty: { gt: 0 },
            ...usableBinStockWhere(),
          },
          select: { availQty: true },
        },
      },
      orderBy: { materialCode: 'asc' },
    });

    return invs.map((i) => ({
      material_id: i.materialId,
      material_code: i.materialCode,
      material_name: i.material?.materialName ?? null,
      uom_code: i.material?.primaryUom?.uomCode ?? null,
      allows_decimal: i.material?.primaryUom?.allowsDecimal ?? true,
      qty_available: i.binStocks.reduce((sum, bs) => sum + bs.availQty, 0),
    }));
  }

  /** Bins of a material in the From warehouse that hold available stock. */
  async binOptions(materialId: string, fromWarehouseId: string) {
    const warehouseId = await this.activeWarehouse(fromWarehouseId, 'From Location');
    if (!materialId) return [];

    const inv = await this.prisma.inventoryManagement.findFirst({
      where: { warehouseId, materialId },
      include: {
        binStocks: {
          where: {
            binId: { not: null },
            availQty: { gt: 0 },
            ...usableBinStockWhere(),
          },
          include: { bin: { select: { binLabel: true, binCode: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!inv) return [];

    return inv.binStocks.map((bs) => ({
      bin_id: bs.binId,
      bin_label: bs.bin?.binLabel ?? null,
      bin_code: bs.bin?.binCode ?? null,
      qty_available: bs.availQty,
      reserved_qty: bs.reservedQty,
      qty_issue: bs.qtyIssue,
      quality_issue: bs.qualityIssue,
    }));
  }

  /**
   * Bins offered on a Sales Return line. A billing warehouse has no bins of its
   * own, so the goods are booked into the destination (To Location) — the bins
   * listed are that warehouse's bins already holding the material.
   */
  async returnBinOptions(materialId: string, toWarehouseId: string) {
    const warehouseId = await this.activeWarehouse(toWarehouseId, 'To Location');
    if (!materialId) return [];

    const inv = await this.prisma.inventoryManagement.findFirst({
      where: { warehouseId, materialId },
      include: {
        binStocks: {
          where: { binId: { not: null }, ...usableBinStockWhere() },
          include: { bin: { select: { binLabel: true, binCode: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!inv) return [];

    return inv.binStocks.map((bs) => ({
      bin_id: bs.binId,
      bin_label: bs.bin?.binLabel ?? null,
      bin_code: bs.bin?.binCode ?? null,
      qty_available: bs.availQty,
      reserved_qty: bs.reservedQty,
      qty_issue: bs.qtyIssue,
      quality_issue: bs.qualityIssue,
    }));
  }

  /**
   * Dropdown values for the tracking filters, from the masters: every active
   * warehouse of the allowed subsidiary (same list as the create form) and
   * every active user.
   */
  async trackingFilterOptions() {
    const [warehouses, users] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isInactive: false, subsidiaryId: subsidiarySingleFilter() },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return {
      origins: warehouses,
      creators: users.map((u) => ({ id: String(u.id), name: u.name })),
    };
  }

  /**
   * Deliveries a return can be copied from: plain deliveries within the user's
   * scope, newest first. The UI autofills the return from the one picked.
   */
  async returnSourceOptions(search: string | undefined, scope: WarehouseScope) {
    const where: Prisma.SalesDeliveryWhereInput = {
      ...this.scopeWhere(scope),
      documentType: 'SalesDelivery',
      // The return is raised FROM the delivery's destination, and that From has
      // to be a billing warehouse — so only such deliveries can be reversed.
      toWarehouse: billingWarehouseWhere(),
    };
    if (search?.trim()) {
      where.AND = [
        { deliveryNumber: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.salesDelivery.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.serializeList(r));
  }

  // ---------- create ----------

  /**
   * There is no Draft stage: the confirmation dialog on the create form is the
   * submission, so a document is born Success and is read-only afterwards.
   * Stock is deliberately NOT moved — see the note on the Prisma model.
   */
  async create(dto: CreateSalesDeliveryDto, scope: WarehouseScope) {
    const isReturn = dto.document_type === 'SalesReturn';

    if (dto.to_warehouse_id === dto.from_warehouse_id) {
      throw new BadRequestException(
        'To Location must be a different warehouse from From Location',
      );
    }

    // A manually typed number is used as is. Deliveries and returns share one
    // number column, so it must not clash with either.
    const manualNumber = dto.delivery_number?.trim() || undefined;
    const numberLabel = isReturn ? 'SR Number' : 'SD Number';
    if (manualNumber) {
      const taken = await this.prisma.salesDelivery.findFirst({
        where: { deliveryNumber: { equals: manualNumber, mode: 'insensitive' } },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException(`${numberLabel} "${manualNumber}" is already used`);
      }
    }

    const [fromWarehouseId, toWarehouseId, department, klass, customer] =
      await Promise.all([
      this.activeWarehouse(dto.from_warehouse_id, 'From Location'),
      this.activeWarehouse(dto.to_warehouse_id, 'To Location'),
      this.prisma.department.findUnique({
        where: { id: dto.department_id },
        select: { id: true },
      }),
      this.prisma.class.findUnique({
        where: { id: dto.class_id },
        select: { id: true },
      }),
      dto.customer_id
        ? this.prisma.customer.findUnique({
            where: { id: dto.customer_id },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (dto.customer_id && !customer) {
      throw new BadRequestException('Selected customer does not exist');
    }
    if (!department) throw new BadRequestException('Selected department does not exist');
    if (!klass) throw new BadRequestException('Selected class does not exist');

    // A return reverses a delivery, so it must name one; a delivery never does.
    let sourceDeliveryId: string | null = null;
    const deliveredPerMaterial = new Map<string, number>();
    if (isReturn) {
      const from = await this.prisma.warehouse.findUnique({
        where: { id: fromWarehouseId },
        select: { name: true },
      });
      if (!isBillingName(from?.name)) {
        throw new BadRequestException(
          `A Sales Return must be raised from a billing warehouse (its name contains "${BILLING_WAREHOUSE_MARKER}")`,
        );
      }
      if (!dto.source_delivery_id) {
        throw new BadRequestException(
          'A Sales Return must be copied from a Sales Delivery',
        );
      }
      const source = await this.prisma.salesDelivery.findUnique({
        where: { id: dto.source_delivery_id },
        select: {
          id: true,
          documentType: true,
          fromWarehouseId: true,
          toWarehouseId: true,
          customerId: true,
          departmentId: true,
          classId: true,
          items: { select: { materialId: true, qtyTransfer: true } },
        },
      });
      if (!source || source.documentType !== 'SalesDelivery') {
        throw new BadRequestException('Source Sales Delivery not found');
      }
      // The return runs the delivery backwards: out of where it was delivered
      // to, back into where it came from.
      if (source.toWarehouseId !== fromWarehouseId) {
        throw new BadRequestException(
          "From Location must be the source delivery's To Location",
        );
      }
      if (source.fromWarehouseId !== toWarehouseId) {
        throw new BadRequestException(
          "To Location must be the source delivery's From Location",
        );
      }
      // The whole header is inherited: the form offers no input for it, so a
      // hand-made request may not quietly change it either.
      if (dto.department_id !== source.departmentId) {
        throw new BadRequestException(
          "Department must be the source delivery's department",
        );
      }
      if (dto.class_id !== source.classId) {
        throw new BadRequestException("Class must be the source delivery's class");
      }
      if ((dto.customer_id ?? null) !== source.customerId) {
        throw new BadRequestException(
          "Customer must be the source delivery's customer",
        );
      }

      sourceDeliveryId = source.id;
      // Never return more of a material than the delivery moved.
      for (const it of source.items) {
        if (!it.materialId) continue;
        deliveredPerMaterial.set(
          it.materialId,
          (deliveredPerMaterial.get(it.materialId) ?? 0) + it.qtyTransfer,
        );
      }
    } else if (dto.source_delivery_id) {
      throw new BadRequestException(
        'Only a Sales Return can reference a source Sales Delivery',
      );
    }

    // A delivery takes its lines out of the From warehouse. A return books them
    // into the destination, so the bins belong to To Location while the
    // quantity is checked against the billing warehouse it comes from.
    const prepared = isReturn
      ? await this.prepareReturnLines(
          fromWarehouseId,
          toWarehouseId,
          dto.items,
          deliveredPerMaterial,
        )
      : await this.prepareLines(fromWarehouseId, dto.items);

    const created = await this.createWithNumber(isReturn, manualNumber, async (numbers, tx) =>
      tx.salesDelivery.create({
        data: {
          deliveryNumber: numbers.deliveryNumber,
          documentNumber: numbers.documentNumber,
          documentType: isReturn ? 'SalesReturn' : 'SalesDelivery',
          sourceDeliveryId,
          status: 'Success',
          fromWarehouseId,
          toWarehouseId,
          customerId: dto.customer_id ?? null,
          departmentId: dto.department_id,
          classId: dto.class_id,
          // Stored as "{memo typed on the form} | {SD number}".
          memo: this.buildMemo(dto.memo, numbers.deliveryNumber),
          createdById: scope.userId,
          items: {
            create: prepared.map((p) => ({
              materialId: p.materialId,
              materialCode: p.materialCode,
              materialName: p.materialName,
              uomCode: p.uomCode,
              binId: p.binId,
              binLabel: p.binLabel,
              remarks: p.remarks,
              qtyTransfer: p.qtyTransfer,
              availAtCreate: p.avail,
            })),
          },
        },
      }),
    );

    this.logger.log(`Sales delivery ${created.deliveryNumber} created`);
    return this.findOne(created.id, scope);
  }

  /**
   * Validate every (material, bin) line against the source warehouse and turn it
   * into the row that is stored. Qty must be positive and can never exceed what
   * the bin actually holds.
   */
  private async prepareLines(
    warehouseId: string,
    items: CreateSalesDeliveryDto['items'],
  ): Promise<PreparedLine[]> {
    if (!items?.length) {
      throw new BadRequestException('Add at least one material and bin');
    }

    const materialIds = [...new Set(items.map((i) => i.material_id))];
    const binIds = [...new Set(items.map((i) => i.bin_id))];

    const inventories = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId, materialId: { in: materialIds } },
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
    });
    const invByMaterial = new Map(inventories.map((i) => [i.materialId!, i]));

    const stocks = await this.prisma.inventoryBinStock.findMany({
      where: {
        binId: { in: binIds },
        inventory: { warehouseId, materialId: { in: materialIds } },
      },
      include: {
        bin: { select: { binLabel: true } },
        inventory: { select: { materialId: true } },
      },
    });
    const stockByKey = new Map(
      stocks.map((st) => [`${st.inventory.materialId}|${st.binId}`, st]),
    );

    const prepared: PreparedLine[] = [];
    const seen = new Set<string>();

    for (const line of items) {
      const key = `${line.material_id}|${line.bin_id}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'The same material and bin appears more than once in this document',
        );
      }
      seen.add(key);

      const inv = invByMaterial.get(line.material_id);
      if (!inv) {
        throw new BadRequestException('Material is not in inventory for this warehouse');
      }
      const stock = stockByKey.get(key);
      if (!stock) {
        throw new BadRequestException(
          'Selected bin does not hold this material in this warehouse',
        );
      }

      const label = `${inv.materialCode ?? line.material_id} @ ${
        stock.bin?.binLabel ?? line.bin_id
      }`;

      // A bin the form may not offer may not be saved through a hand-made
      // request either.
      if (isFrozenBinLabel(stock.bin?.binLabel)) {
        throw new BadRequestException(
          `${label}: this bin holds frozen (KIT) stock and cannot be transferred out`,
        );
      }

      const qty = Number(line.qty_transfer);
      if (!Number.isFinite(qty)) {
        throw new BadRequestException(`${label}: Qty Transfer must be a number`);
      }
      if (qty <= EPS) {
        throw new BadRequestException(
          `${label}: Qty Transfer must be greater than 0 (negative quantities are not allowed)`,
        );
      }
      if (qty > stock.availQty + EPS) {
        throw new BadRequestException(
          `${label}: Qty Transfer (${qty}) exceeds the available qty (${stock.availQty})`,
        );
      }
      const allowsDecimal = inv.material?.primaryUom?.allowsDecimal ?? true;
      if (!allowsDecimal && Math.abs(qty - Math.round(qty)) > EPS) {
        throw new BadRequestException(
          `${label}: the unit of measure does not allow decimal quantities`,
        );
      }

      prepared.push({
        materialId: line.material_id,
        materialCode: inv.materialCode,
        materialName: inv.material?.materialName ?? null,
        uomCode: inv.material?.primaryUom?.uomCode ?? null,
        binId: line.bin_id,
        binLabel: stock.bin?.binLabel ?? null,
        remarks: line.remarks?.trim() || null,
        qtyTransfer: qty,
        avail: stock.availQty,
      });
    }

    return prepared;
  }

  /** FR: the memo that is stored is "{form memo} | {SD number}". */
  private buildMemo(input: string | null | undefined, deliveryNumber: string) {
    const text = (input ?? '').trim();
    return text ? `${text} | ${deliveryNumber}` : deliveryNumber;
  }

  /**
   * Lines of a Sales Return. The bin belongs to the DESTINATION warehouse (a
   * billing warehouse holds no bins of its own), while the quantity is checked
   * against what the billing warehouse it returns from actually holds for that
   * material.
   */
  private async prepareReturnLines(
    billingWarehouseId: string,
    toWarehouseId: string,
    items: CreateSalesDeliveryDto['items'],
    /** materialId -> qty the source delivery moved; the return cannot exceed it. */
    deliveredPerMaterial: Map<string, number>,
  ): Promise<PreparedLine[]> {
    if (!items?.length) {
      throw new BadRequestException('Add at least one material and bin');
    }

    const materialIds = [...new Set(items.map((i) => i.material_id))];
    const binIds = [...new Set(items.map((i) => i.bin_id))];

    // Destination inventory: this is where the bin must live.
    const destInventories = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId: toWarehouseId, materialId: { in: materialIds } },
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
    });
    const destByMaterial = new Map(destInventories.map((i) => [i.materialId!, i]));

    const destStocks = await this.prisma.inventoryBinStock.findMany({
      where: {
        binId: { in: binIds },
        inventory: { warehouseId: toWarehouseId, materialId: { in: materialIds } },
      },
      include: {
        bin: { select: { binLabel: true } },
        inventory: { select: { materialId: true } },
      },
    });
    const destStockByKey = new Map(
      destStocks.map((st) => [`${st.inventory.materialId}|${st.binId}`, st]),
    );

    // Billing availability, summed per material — a billing warehouse has no
    // bins, so the check is at material level.
    const billingInventories = await this.prisma.inventoryManagement.findMany({
      where: { warehouseId: billingWarehouseId, materialId: { in: materialIds } },
      include: { binStocks: { select: { availQty: true } } },
    });
    const billingAvail = new Map(
      billingInventories.map((i) => [
        i.materialId!,
        i.binStocks.reduce((a, b) => a + b.availQty, 0),
      ]),
    );

    const prepared: PreparedLine[] = [];
    const seen = new Set<string>();
    // Several lines of one material draw on the same billing balance.
    const takenPerMaterial = new Map<string, number>();

    for (const line of items) {
      const key = `${line.material_id}|${line.bin_id}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'The same material and bin appears more than once in this document',
        );
      }
      seen.add(key);

      const inv = destByMaterial.get(line.material_id);
      if (!inv) {
        throw new BadRequestException(
          'Material is not in inventory at the To Location',
        );
      }
      const stock = destStockByKey.get(key);
      if (!stock) {
        throw new BadRequestException(
          'Selected bin does not hold this material at the To Location',
        );
      }

      const label = `${inv.materialCode ?? line.material_id} @ ${
        stock.bin?.binLabel ?? line.bin_id
      }`;
      if (isFrozenBinLabel(stock.bin?.binLabel)) {
        throw new BadRequestException(
          `${label}: this bin holds frozen (KIT) stock and cannot be used`,
        );
      }

      const qty = Number(line.qty_transfer);
      if (!Number.isFinite(qty)) {
        throw new BadRequestException(`${label}: Qty must be a number`);
      }
      if (qty <= EPS) {
        throw new BadRequestException(
          `${label}: Qty must be greater than 0 (negative quantities are not allowed)`,
        );
      }

      const alreadyTaken = takenPerMaterial.get(line.material_id) ?? 0;

      // Cap 1: never more than the delivery actually moved.
      const delivered = deliveredPerMaterial.get(line.material_id) ?? 0;
      if (alreadyTaken + qty > delivered + EPS) {
        throw new BadRequestException(
          `${label}: Qty (${alreadyTaken + qty}) exceeds the ${delivered} delivered on the source Sales Delivery`,
        );
      }

      // Cap 2: never more than the billing warehouse holds.
      const available = billingAvail.get(line.material_id) ?? 0;
      if (alreadyTaken + qty > available + EPS) {
        throw new BadRequestException(
          `${label}: Qty (${alreadyTaken + qty}) exceeds the billing warehouse's available qty (${available}) for this material`,
        );
      }
      takenPerMaterial.set(line.material_id, alreadyTaken + qty);

      const allowsDecimal = inv.material?.primaryUom?.allowsDecimal ?? true;
      if (!allowsDecimal && Math.abs(qty - Math.round(qty)) > EPS) {
        throw new BadRequestException(
          `${label}: the unit of measure does not allow decimal quantities`,
        );
      }

      prepared.push({
        materialId: line.material_id,
        materialCode: inv.materialCode,
        materialName: inv.material?.materialName ?? null,
        uomCode: inv.material?.primaryUom?.uomCode ?? null,
        binId: line.bin_id,
        binLabel: stock.bin?.binLabel ?? null,
        remarks: line.remarks?.trim() || null,
        qtyTransfer: qty,
        // Context shown on the document: what the BILLING side had available.
        avail: available,
      });
    }

    return prepared;
  }

  /**
   * Allocate both document numbers and run `build` inside a transaction,
   * retrying on either unique-number constraint so two documents created at the
   * same moment do not fail the second caller. A manual delivery number is
   * used as typed: only the transfer number is generated, and a clash on the
   * delivery number is reported rather than retried.
   */
  private async createWithNumber<T>(
    isReturn: boolean,
    manualDeliveryNumber: string | undefined,
    build: (
      numbers: { deliveryNumber: string; documentNumber: string },
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const generated = await this.nextNumbers(isReturn);
      const numbers = manualDeliveryNumber
        ? { ...generated, deliveryNumber: manualDeliveryNumber }
        : generated;
      try {
        return await this.prisma.$transaction((tx) => build(numbers, tx));
      } catch (e) {
        const target = String(
          (e as Prisma.PrismaClientKnownRequestError)?.meta?.target ?? '',
        );
        const isDuplicateNumber =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          (target.includes('delivery_number') || target.includes('document_number'));
        if (!isDuplicateNumber) throw e;
        if (manualDeliveryNumber && target.includes('delivery_number')) {
          throw new BadRequestException(
            `${isReturn ? 'SR' : 'SD'} Number "${manualDeliveryNumber}" is already used`,
          );
        }
        this.logger.warn(
          `Number ${numbers.deliveryNumber}/${numbers.documentNumber} was taken; ` +
            `retrying (${attempt + 1}/5)`,
        );
      }
    }
    throw new BadRequestException(
      'Could not allocate a delivery number — please try again',
    );
  }

  /**
   * SD-YYYYMMDD-NNN for a delivery, SR-YYYYMMDD-NNN for a return, plus the
   * TI-YYYYMMDD-NNN transfer number both carry.
   */
  private async nextNumbers(isReturn: boolean): Promise<{
    deliveryNumber: string;
    documentNumber: string;
  }> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [deliveryNumber, documentNumber] = await Promise.all([
      this.nextNumber(`${isReturn ? 'SR' : 'SD'}-${today}-`, 'deliveryNumber'),
      this.nextNumber(`TI-${today}-`, 'documentNumber'),
    ]);
    return { deliveryNumber, documentNumber };
  }

  /**
   * Next number for today on one of the two number columns. Derived from the
   * highest suffix in use, not from the row count: counting collides as soon as
   * a document is removed (five rows numbered 001-004 and 007 would propose 006,
   * then 007 again).
   */
  private async nextNumber(
    prefix: string,
    column: 'deliveryNumber' | 'documentNumber',
  ): Promise<string> {
    const rows = await this.prisma.salesDelivery.findMany({
      where: { [column]: { startsWith: prefix } },
      select: { [column]: true },
    });
    const highest = rows.reduce((max, r) => {
      const n = Number(String(r[column]).slice(prefix.length));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  }

  // ---------- read ----------

  async findAll(query: QuerySalesDeliveryDto, scope: WarehouseScope) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, {
      createdAt: 'desc',
    });

    const where: Prisma.SalesDeliveryWhereInput = { ...this.scopeWhere(scope) };

    // AND keeps every filter from widening the scope's own OR. Several values
    // on one column are OR-ed ("any of these"); separate columns stay AND-ed.
    const and: Prisma.SalesDeliveryWhereInput[] = [];
    if (query.search) {
      and.push({ deliveryNumber: { contains: query.search, mode: 'insensitive' } });
    }
    if (query.document_type) {
      and.push({ documentType: query.document_type });
    }
    if (query.to_warehouse_id) {
      and.push({ toWarehouseId: query.to_warehouse_id });
    }

    const filters = (query.filters ?? [])
      .map((f) => ({
        field: f.field,
        values: (f.values ?? []).map((v) => v.trim()).filter(Boolean),
      }))
      .filter((f) => f.values.length);

    const itemClauses: Prisma.SalesDeliveryItemWhereInput[] = [];
    for (const f of filters) {
      if (SALES_DELIVERY_ITEM_FIELDS.includes(f.field)) {
        itemClauses.push({ OR: f.values.map((v) => ITEM_FILTERS[f.field](v)) });
      } else if (SALES_DELIVERY_DATE_FIELDS.includes(f.field)) {
        and.push({ OR: f.values.map((v) => this.createdAtRange(v)) });
      } else if (f.field === 'status') {
        and.push({ OR: f.values.map((v) => this.statusFilter(v)) });
      } else {
        and.push({ OR: f.values.map((v) => HEADER_FILTERS[f.field](v)) });
      }
    }
    // Item filters are AND-ed inside ONE line: asking for a material code and a
    // bin means a single line matches both, not two different lines.
    if (itemClauses.length) {
      and.push({ items: { some: { AND: itemClauses } } });
    }
    if (and.length) where.AND = and;

    const [total, rows, qtySum] = await this.prisma.$transaction([
      this.prisma.salesDelivery.count({ where }),
      this.prisma.salesDelivery.findMany({
        where,
        include: listInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      // Quantity moved by every matching document, not only this page.
      this.prisma.salesDeliveryItem.aggregate({
        where: { salesDelivery: where },
        _sum: { qtyTransfer: true },
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      totals: { qty: qtySum._sum.qtyTransfer ?? 0 },
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
        filters,
      },
      rows: rows.map((r) => ({
        ...this.serializeList(r),
        // The list's accordion opens every row, so it takes the lines along.
        ...(query.include_items === 'true' ? { items: r.items.map((it) => this.serializeItem(it)) } : {}),
      })),
    };
  }

  /** Status is an enum; an unrecognised value matches nothing. */
  private statusFilter(value: string): Prisma.SalesDeliveryWhereInput {
    const members = Object.values(SalesDeliveryStatus);
    const match = members.find((m) => m.toLowerCase() === value.toLowerCase());
    return { status: match ? { equals: match } : { in: [] } };
  }

  /**
   * Turn "YYYY-MM-DD[THH:mm]..YYYY-MM-DD[THH:mm]" into a createdAt window.
   * Either side may be empty for an open-ended range, and the time is optional
   * on each side. Values are read in the server's local time; whichever unit
   * the user stopped at is included in full.
   */
  private createdAtRange(value: string): Prisma.SalesDeliveryWhereInput {
    const [rawFrom = '', rawTo = ''] = value.split('..');

    const parse = (raw: string, edge: 'start' | 'end'): Date | null => {
      const t = raw.trim();
      if (!t) return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(t);
      if (!m) {
        throw new BadRequestException(
          `Date filter must be "YYYY-MM-DD[THH:mm]..YYYY-MM-DD[THH:mm]" (got "${value}")`,
        );
      }
      const hasTime = m[4] !== undefined;
      const hh = hasTime ? Number(m[4]) : edge === 'start' ? 0 : 23;
      const mm = hasTime ? Number(m[5]) : edge === 'start' ? 0 : 59;
      if (hh > 23 || mm > 59) {
        throw new BadRequestException(`"${t}" is not a valid time`);
      }
      const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        hh,
        mm,
        edge === 'start' ? 0 : 59,
        edge === 'start' ? 0 : 999,
      );
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`"${t}" is not a valid date`);
      }
      return d;
    };

    const from = parse(rawFrom, 'start');
    const to = parse(rawTo, 'end');
    if (!from && !to) {
      throw new BadRequestException(
        'A date filter needs at least one side of the range',
      );
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'The start of the date range is after its end',
      );
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    return { createdAt };
  }

  async findOne(id: string, scope: WarehouseScope) {
    const sd = await this.prisma.salesDelivery.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!sd || !this.canSee(sd, scope)) {
      throw new NotFoundException(`Sales delivery ${id} not found`);
    }
    return this.serializeDetail(sd);
  }

  // ---------- serializers ----------

  private serializeList(sd: SdList) {
    const materials = new Set(sd.items.map((it) => it.materialId ?? it.materialCode));
    return {
      id: sd.id,
      delivery_number: sd.deliveryNumber,
      document_type: sd.documentType,
      source_delivery_number: sd.sourceDelivery?.deliveryNumber ?? null,
      status: sd.status,
      from_warehouse: sd.fromWarehouse?.name ?? null,
      to_warehouse: sd.toWarehouse?.name ?? null,
      customer: sd.customer?.companyName ?? null,
      department: sd.department?.name ?? null,
      class: sd.class?.name ?? null,
      material_count: materials.size,
      total_qty: sd.items.reduce((s, it) => s + it.qtyTransfer, 0),
      memo: sd.memo,
      created_by: sd.createdBy?.name ?? null,
      created_at: sd.createdAt,
    };
  }

  private serializeDetail(sd: SdDetail) {
    return {
      id: sd.id,
      delivery_number: sd.deliveryNumber,
      document_type: sd.documentType,
      source_delivery_id: sd.sourceDeliveryId,
      source_delivery_number: sd.sourceDelivery?.deliveryNumber ?? null,
      status: sd.status,
      from_warehouse_id: sd.fromWarehouseId,
      from_warehouse: sd.fromWarehouse?.name ?? null,
      to_warehouse_id: sd.toWarehouseId,
      to_warehouse: sd.toWarehouse?.name ?? null,
      customer_id: sd.customerId,
      customer_name: sd.customer?.companyName ?? null,
      customer_entity_id: sd.customer?.entityId ?? null,
      department_id: sd.departmentId,
      department_name: sd.department?.name ?? null,
      department_oracle_id: sd.department?.oracleId ?? null,
      class_id: sd.classId,
      class_name: sd.class?.name ?? null,
      class_oracle_id: sd.class?.oracleId ?? null,
      memo: sd.memo,
      created_by: sd.createdBy?.name ?? null,
      created_at: sd.createdAt,
      total_qty: sd.items.reduce((s, it) => s + it.qtyTransfer, 0),
      items: sd.items.map((it) => this.serializeItem(it)),
    };
  }

  private serializeItem(it: SdDetail['items'][number]) {
    return {
      id: it.id,
      material_id: it.materialId,
      material_code: it.materialCode,
      material_name: it.materialName,
      uom_code: it.uomCode,
      bin_id: it.binId,
      bin_label: it.binLabel ?? it.bin?.binLabel ?? null,
      bin_code: it.bin?.binCode ?? null,
      remarks: it.remarks,
      qty_transfer: it.qtyTransfer,
      avail_at_create: it.availAtCreate,
    };
  }
}
