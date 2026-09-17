import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import type { CreateSalesDeliveryDto } from './dto/create-sales-delivery.dto';
import type { QuerySalesDeliveryDto } from './dto/query-sales-delivery.dto';

export interface WarehouseScope {
  userId: number;
  role: string;
  warehouseId: string | null;
}

const EPS = 1e-9;

const listInclude = {
  fromWarehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: true,
} satisfies Prisma.SalesDeliveryInclude;

const detailInclude = {
  fromWarehouse: { select: { id: true, name: true, oracleId: true } },
  toWarehouse: { select: { id: true, name: true, oracleId: true } },
  department: { select: { id: true, name: true, oracleId: true } },
  class: { select: { id: true, name: true, oracleId: true } },
  createdBy: { select: { id: true, name: true } },
  items: {
    include: { bin: { select: { binLabel: true } } },
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

  /** An active warehouse picked on the form, or a 400 naming the field. */
  private async activeWarehouse(id: string | undefined, field: string) {
    if (!id) throw new BadRequestException(`${field} is required`);
    const w = await this.prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, isInactive: true },
    });
    if (!w || w.isInactive) {
      throw new BadRequestException(`Selected ${field} does not exist or is inactive`);
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
    const [warehouses, departments, classes, user] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isInactive: false },
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
        binStocks: { some: { binId: { not: null }, availQty: { gt: 0 } } },
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
      },
      orderBy: { materialCode: 'asc' },
    });

    return invs.map((i) => ({
      material_id: i.materialId,
      material_code: i.materialCode,
      material_name: i.material?.materialName ?? null,
      uom_code: i.material?.primaryUom?.uomCode ?? null,
      allows_decimal: i.material?.primaryUom?.allowsDecimal ?? true,
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
          where: { binId: { not: null }, availQty: { gt: 0 } },
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
      reserved_qty: bs.reservedQty,
      qty_issue: bs.qtyIssue,
      quality_issue: bs.qualityIssue,
    }));
  }

  // ---------- create ----------

  /**
   * There is no Draft stage: the confirmation dialog on the create form is the
   * submission, so a document is born Success and is read-only afterwards.
   * Stock is deliberately NOT moved — see the note on the Prisma model.
   */
  async create(dto: CreateSalesDeliveryDto, scope: WarehouseScope) {
    if (dto.to_warehouse_id === dto.from_warehouse_id) {
      throw new BadRequestException(
        'To Location must be a different warehouse from From Location',
      );
    }

    const [fromWarehouseId, toWarehouseId, department, klass] = await Promise.all([
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
    ]);
    if (!department) throw new BadRequestException('Selected department does not exist');
    if (!klass) throw new BadRequestException('Selected class does not exist');

    const prepared = await this.prepareLines(fromWarehouseId, dto.items);

    const created = await this.createWithNumber(async (numbers, tx) =>
      tx.salesDelivery.create({
        data: {
          deliveryNumber: numbers.deliveryNumber,
          documentNumber: numbers.documentNumber,
          status: 'Success',
          fromWarehouseId,
          toWarehouseId,
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
   * Allocate both document numbers and run `build` inside a transaction,
   * retrying on either unique-number constraint so two documents created at the
   * same moment do not fail the second caller.
   */
  private async createWithNumber<T>(
    build: (
      numbers: { deliveryNumber: string; documentNumber: string },
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const numbers = await this.nextNumbers();
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

  /** SD-YYYYMMDD-NNN for the document, TI-YYYYMMDD-NNN for the transfer. */
  private async nextNumbers(): Promise<{
    deliveryNumber: string;
    documentNumber: string;
  }> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [deliveryNumber, documentNumber] = await Promise.all([
      this.nextNumber(`SD-${today}-`, 'deliveryNumber'),
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
    if (query.to_warehouse_id) where.toWarehouseId = query.to_warehouse_id;
    if (query.search) {
      // AND keeps the search from widening the scope's own OR.
      where.AND = [{ deliveryNumber: { contains: query.search, mode: 'insensitive' } }];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesDelivery.count({ where }),
      this.prisma.salesDelivery.findMany({
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
        to_warehouse_id: query.to_warehouse_id ?? null,
      },
      rows: rows.map((r) => this.serializeList(r)),
    };
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
      status: sd.status,
      from_warehouse: sd.fromWarehouse?.name ?? null,
      to_warehouse: sd.toWarehouse?.name ?? null,
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
      status: sd.status,
      from_warehouse_id: sd.fromWarehouseId,
      from_warehouse: sd.fromWarehouse?.name ?? null,
      to_warehouse_id: sd.toWarehouseId,
      to_warehouse: sd.toWarehouse?.name ?? null,
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
      items: sd.items.map((it) => ({
        id: it.id,
        material_id: it.materialId,
        material_code: it.materialCode,
        material_name: it.materialName,
        uom_code: it.uomCode,
        bin_id: it.binId,
        bin_label: it.binLabel ?? it.bin?.binLabel ?? null,
        qty_transfer: it.qtyTransfer,
        avail_at_create: it.availAtCreate,
      })),
    };
  }
}
