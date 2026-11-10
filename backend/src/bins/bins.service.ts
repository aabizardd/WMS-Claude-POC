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
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { inScope, scopeWhere } from '../common/warehouse-scope';
import { type ExportColumn, wibDateTimeMinutes, wibParts, writeXlsx } from '../common/xlsx-export';
import type { Writable } from 'stream';

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
  // Every warehouse the user may see; null = no limit (see common/warehouse-scope).
  warehouseIds: string[] | null;
}

type BinOrder = Prisma.BinOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => BinOrder> = {
  bin_label: (d) => ({ binLabel: d }),
  bin_code: (d) => ({ binCode: d }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  aisle: (d) => ({ aisle: { aisleName: d } }),
  shelf: (d) => ({ shelf: { shelfLabel: d } }),
  area_type: (d) => ({ areaType: { areaTypeName: d } }),
  status: (d) => ({ isActive: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: BinOrder = { binLabel: 'desc' };

@Injectable()
export class BinsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryBinDto, scope: WarehouseScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      SORTABLE,
      DEFAULT_ORDER,
    );

    const where = this.where(query, scope);

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
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
      rows: rows.map((r) => this.serialize(r)),
    };
  }

  private where(query: Pick<QueryBinDto, 'search'>, scope: WarehouseScope): Prisma.BinWhereInput {
    const where: Prisma.BinWhereInput = query.search
      ? {
          OR: [
            { binLabel: { contains: query.search, mode: 'insensitive' } },
            { binCode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    // Non-admins see the bins of every warehouse they are assigned; admins
    // follow the header selector ("All sites" = no limit).
    Object.assign(where, scopeWhere(scope));
    return where;
  }

  /** The list's export: every bin the search matches (not only one page), in the list's order. */
  async *exportRows(query: QueryBinDto, scope: WarehouseScope): AsyncGenerator<BinWithRelations[]> {
    const where = this.where(query, scope);
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const BATCH = 500;
    for (let skip = 0; ; skip += BATCH) {
      const rows = await this.prisma.bin.findMany({
        where,
        include: binInclude,
        // The id keeps paging stable when the sort column has ties.
        orderBy: [orderBy, { id: 'asc' }],
        skip,
        take: BATCH,
      });
      if (rows.length) yield rows;
      if (rows.length < BATCH) return;
    }
  }

  /** The export confirmation's numbers: bins for the current search and for all data. */
  async exportSummary(query: QueryBinDto, scope: WarehouseScope) {
    const [filtered, all] = await Promise.all([
      this.prisma.bin.count({ where: this.where(query, scope) }),
      this.prisma.bin.count({ where: this.where({}, scope) }),
    ]);
    return { filtered: { documents: filtered, rows: filtered }, all: { documents: all, rows: all } };
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
      (scope.role !== 'admin' && !inScope(scope, bin.warehouseId))
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

// ---------- export ----------

const at = (d: Date | null) => (d ? wibDateTimeMinutes(d) : null);

/** The Bin list's columns, in its order (one row per bin). */
const EXPORT_COLUMNS: ExportColumn<BinWithRelations>[] = [
  { header: 'Status', width: 10, value: (b) => (b.isActive ? 'Active' : 'Inactive') },
  { header: 'Bin ID', width: 22, value: (b) => b.binCode },
  { header: 'Warehouse Name', width: 26, value: (b) => b.warehouse.name },
  { header: 'Aisle Name', width: 18, value: (b) => b.aisle.aisleName },
  { header: 'Shelf Label', width: 18, value: (b) => b.shelf.shelfLabel },
  { header: 'Bin Label', width: 22, value: (b) => b.binLabel },
  { header: 'Bin Length', width: 11, value: (b) => b.binLength },
  { header: 'Bin Width', width: 11, value: (b) => b.binWidth },
  { header: 'Bin Height', width: 11, value: (b) => b.binHeight },
  {
    header: 'UoM',
    width: 16,
    value: (b) =>
      b.dimensionUom?.uomCode
        ? `${b.dimensionUom.uomCode}${b.dimensionUom.uomName ? ` - ${b.dimensionUom.uomName}` : ''}`
        : null,
  },
  { header: 'Bin Volume', width: 12, value: (b) => b.binLength * b.binWidth * b.binHeight },
  { header: 'Created By', width: 20, value: (b) => b.createdBy },
  { header: 'Created At', width: 18, value: (b) => at(b.createdAt) },
  { header: 'Last Modified By', width: 20, value: (b) => b.modifiedBy },
  { header: 'Last Modified At', width: 18, value: (b) => at(b.modifiedAt) },
];

/** "bin_export_20261109_101502.xlsx" (WIB). */
export function binExportFileName(now = new Date()) {
  const t = wibParts(now);
  return `bin_export_${t.y}${t.m}${t.d}_${t.hh}${t.mm}${t.ss}.xlsx`;
}

/** Streams the one-sheet workbook to `out`: white headers on indigo, frozen. */
export function writeBinXlsx(rows: AsyncIterable<BinWithRelations[]>, out: Writable) {
  return writeXlsx(out, [{ name: 'Bin', columns: EXPORT_COLUMNS, rows }], {
    fill: 'FF5166AE',
    font: 'FFFFFFFF',
    freeze: true,
  });
}
