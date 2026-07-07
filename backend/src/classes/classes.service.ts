import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type ClassRow = Prisma.ClassGetPayload<object>;

type ClassOrder = Prisma.ClassOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => ClassOrder> = {
  oracle_id: (d) => ({ oracleId: d }),
  name: (d) => ({ name: d }),
  parent_name: (d) => ({ parentName: d }),
  subsidiary_name: (d) => ({ subsidiaryName: d }),
  is_inactive: (d) => ({ isInactive: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: ClassOrder = { createdAt: 'desc' };

@Injectable()
export class ClassesService {
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

    const where: Prisma.ClassWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { parentName: { contains: query.search, mode: 'insensitive' } },
            { subsidiaryName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.class.count({ where }),
      this.prisma.class.findMany({
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

  // Lightweight lookup for dropdowns.
  options() {
    return this.prisma.class.findMany({
      where: { isInactive: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, oracleId: true },
    });
  }

  // Most recent created_at — used as the "last sync" timestamp.
  async getLastSyncAt() {
    const latest = await this.prisma.class.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(c: ClassRow) {
    return {
      id: c.id,
      oracle_id: c.oracleId,
      name: c.name,
      is_inactive: c.isInactive,
      parent_id: c.parentId,
      parent_name: c.parentName,
      subsidiary_id: c.subsidiaryId,
      subsidiary_name: c.subsidiaryName,
      last_modified: c.lastModified,
      created_at: c.createdAt,
    };
  }
}
