import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type WarehouseRow = Prisma.WarehouseGetPayload<object>;

type WarehouseOrder = Prisma.WarehouseOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => WarehouseOrder> = {
  oracle_id: (d) => ({ oracleId: d }),
  name: (d) => ({ name: d }),
  type: (d) => ({ locationTypeName: d }),
  parent: (d) => ({ parentName: d }),
  subsidiary: (d) => ({ subsidiaryName: d }),
  timezone: (d) => ({ timezone: d }),
  status: (d) => ({ isInactive: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: WarehouseOrder = { createdAt: 'desc' };

@Injectable()
export class WarehousesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    sort_by?: string;
    sort_order?: string;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      SORTABLE,
      DEFAULT_ORDER,
    );

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
      attributes: {
        page,
        limit,
        sort_by: query.sort_by ?? null,
        sort_order: query.sort_order ?? null,
      },
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
