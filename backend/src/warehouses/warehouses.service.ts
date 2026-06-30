import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type WarehouseRow = Prisma.WarehouseGetPayload<object>;

const ORDER_FIELD_MAP: Record<string, keyof Prisma.WarehouseOrderByWithRelationInput> =
  {
    created_at: 'createdAt',
    name: 'name',
    last_modified: 'lastModified',
  };

@Injectable()
export class WarehousesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    order_by?: string;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = this.parseOrderBy(query.order_by ?? 'created_at desc');

    const where: Prisma.WarehouseWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { parentName: { contains: query.search, mode: 'insensitive' } },
            {
              subsidiaryName: { contains: query.search, mode: 'insensitive' },
            },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.warehouse.count({ where }),
      this.prisma.warehouse.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: { page, limit, order_by: query.order_by ?? 'created_at desc' },
      rows: rows.map((r) => this.serialize(r)),
    };
  }

  // Lightweight lookup for dropdowns (id + name).
  options() {
    return this.prisma.warehouse.findMany({
      where: { isInactive: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, oracleId: true },
    });
  }

  // Most recent created_at — used as the "last sync" timestamp.
  async getLastSyncAt() {
    const latest = await this.prisma.warehouse.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private parseOrderBy(
    orderByStr: string,
  ): Prisma.WarehouseOrderByWithRelationInput {
    const [rawField, rawDir] = orderByStr.trim().split(/\s+/);
    const field = ORDER_FIELD_MAP[rawField] ?? 'createdAt';
    const dir: Prisma.SortOrder = rawDir === 'asc' ? 'asc' : 'desc';
    return { [field]: dir };
  }

  private serialize(w: WarehouseRow) {
    return {
      id: w.id,
      oracle_id: w.oracleId,
      name: w.name,
      is_inactive: w.isInactive,
      parent_id: w.parentId,
      parent_name: w.parentName,
      subsidiary_id: w.subsidiaryId,
      subsidiary_name: w.subsidiaryName,
      location_type: w.locationType,
      location_type_name: w.locationTypeName,
      timezone: w.timezone,
      make_inventory_available: w.makeInventoryAvailable,
      last_modified: w.lastModified,
      created_at: w.createdAt,
    };
  }
}
