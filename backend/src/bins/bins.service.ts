import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBinDto } from './dto/create-bin.dto';
import { UpdateBinDto } from './dto/update-bin.dto';
import { QueryBinDto } from './dto/query-bin.dto';

const binInclude = {
  warehouse: true,
  aisle: true,
  shelf: true,
  areaType: true,
  dimensionUom: true,
} satisfies Prisma.BinInclude;

type BinWithRelations = Prisma.BinGetPayload<{ include: typeof binInclude }>;

// Used to scope reads to the current user's warehouse (admin bypasses).
export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

const ORDER_FIELD_MAP: Record<string, keyof Prisma.BinOrderByWithRelationInput> =
  {
    created_at: 'createdAt',
    modified_at: 'modifiedAt',
    bin_label: 'binLabel',
    bin_code: 'binCode',
  };

@Injectable()
export class BinsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryBinDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = this.parseOrderBy(query.order_by ?? 'bin_label desc');

    const where: Prisma.BinWhereInput = query.search
      ? {
          OR: [
            { binLabel: { contains: query.search, mode: 'insensitive' } },
            { binCode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    // Non-admins only see bins in their warehouse.
    if (scope.role !== 'admin') {
      where.warehouseId = scope.warehouseId ?? '__no_warehouse__';
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bin.count({ where }),
      this.prisma.bin.findMany({
        where,
        include: binInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: { page, limit, order_by: query.order_by ?? 'bin_label desc' },
      rows: rows.map((r) => this.serialize(r)),
    };
  }

  // Lightweight lookup for dropdowns (optionally limited to one warehouse).
  options(warehouseId?: string) {
    return this.prisma.bin.findMany({
      where: { isActive: true, ...(warehouseId ? { warehouseId } : {}) },
      orderBy: { binLabel: 'asc' },
      select: { id: true, binLabel: true, binCode: true, warehouseId: true },
    });
  }

  async findOne(id: string, scope: WarehouseScope) {
    const bin = await this.prisma.bin.findUnique({
      where: { id },
      include: binInclude,
    });
    if (
      !bin ||
      (scope.role !== 'admin' && bin.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`Bin ${id} not found`);
    }
    return this.serialize(bin);
  }

  async create(dto: CreateBinDto, actor?: string) {
    await this.validateRefs(dto);
    try {
      const created = await this.prisma.bin.create({
        data: {
          binLabel: dto.binLabel,
          binCode: dto.binCode,
          warehouseId: dto.warehouseId,
          aisleId: dto.aisleId,
          shelfId: dto.shelfId,
          areaTypeId: dto.areaTypeId,
          ...this.optionalData(dto),
          createdBy: actor,
        },
        include: binInclude,
      });
      return this.serialize(created);
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateBinDto, actor?: string) {
    const existing = await this.prisma.bin.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Bin ${id} not found`);
    await this.validateRefs(dto);
    try {
      const updated = await this.prisma.bin.update({
        where: { id },
        data: {
          binLabel: dto.binLabel,
          binCode: dto.binCode,
          warehouseId: dto.warehouseId,
          aisleId: dto.aisleId,
          shelfId: dto.shelfId,
          areaTypeId: dto.areaTypeId,
          ...this.optionalData(dto),
          modifiedBy: actor,
          modifiedAt: new Date(),
        },
        include: binInclude,
      });
      return this.serialize(updated);
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.bin.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Bin ${id} not found`);
    await this.prisma.bin.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------- helpers ----------

  private optionalData(dto: CreateBinDto | UpdateBinDto) {
    return {
      dimensionUomId: dto.dimensionUomId ?? null,
      binLength: dto.binLength,
      binWidth: dto.binWidth,
      binHeight: dto.binHeight,
      maxCapacity: dto.maxCapacity,
      isActive: dto.isActive,
    };
  }

  private async validateRefs(dto: CreateBinDto | UpdateBinDto) {
    const checks: [string | undefined, () => Promise<unknown>, string][] = [
      [
        dto.warehouseId,
        () => this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } }),
        'warehouse',
      ],
      [
        dto.aisleId,
        () => this.prisma.aisle.findUnique({ where: { id: dto.aisleId } }),
        'aisle',
      ],
      [
        dto.shelfId,
        () => this.prisma.shelf.findUnique({ where: { id: dto.shelfId } }),
        'shelf',
      ],
      [
        dto.areaTypeId,
        () => this.prisma.areaType.findUnique({ where: { id: dto.areaTypeId } }),
        'area type',
      ],
      [
        dto.dimensionUomId,
        () => this.prisma.uom.findUnique({ where: { id: dto.dimensionUomId } }),
        'dimension UOM',
      ],
    ];
    for (const [value, lookup, label] of checks) {
      if (value && !(await lookup())) {
        throw new BadRequestException(`Invalid ${label}`);
      }
    }
  }

  private parseOrderBy(orderByStr: string): Prisma.BinOrderByWithRelationInput {
    const [rawField, rawDir] = orderByStr.trim().split(/\s+/);
    const field = ORDER_FIELD_MAP[rawField] ?? 'binLabel';
    const dir: Prisma.SortOrder = rawDir === 'asc' ? 'asc' : 'desc';
    return { [field]: dir };
  }

  // Shape the entity into the reference API response format.
  private serialize(b: BinWithRelations) {
    return {
      id: b.id,
      shelf_id: b.shelfId,
      aisle_id: b.aisleId,
      warehouse_id: b.warehouseId,
      area_type_id: b.areaTypeId,
      dimension_uom_id: b.dimensionUomId,
      bin_label: b.binLabel,
      bin_code: b.binCode,
      bin_length: b.binLength,
      bin_width: b.binWidth,
      bin_height: b.binHeight,
      max_capacity: b.maxCapacity,
      shelf: { shelf_label: b.shelf.shelfLabel, shelf_code: b.shelf.shelfCode },
      aisle: { aisle_name: b.aisle.aisleName, aisle_code: b.aisle.aisleCode },
      warehouse_name: {
        warehouse_name: b.warehouse.name,
        warehouse_code: b.warehouse.oracleId,
      },
      warehouse_area_type: {
        area_type_name: b.areaType.areaTypeName,
        area_type_code: b.areaType.areaTypeCode,
      },
      dimension_uom: b.dimensionUom
        ? { uom_name: b.dimensionUom.uomName, uom_code: b.dimensionUom.uomCode }
        : {},
      is_active: b.isActive,
      created_at: b.createdAt,
      created_by: b.createdBy,
      modified_by: b.modifiedBy,
      modified_at: b.modifiedAt,
    };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Bin code already exists');
    }
    return e;
  }
}
