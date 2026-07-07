import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type SubsidiaryRow = Prisma.SubsidiaryGetPayload<object>;

type SubsidiaryOrder = Prisma.SubsidiaryOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => SubsidiaryOrder> = {
  oracle_id: (d) => ({ oracleId: d }),
  name: (d) => ({ name: d }),
  full_name: (d) => ({ fullName: d }),
  is_delete: (d) => ({ isDelete: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: SubsidiaryOrder = { createdAt: 'desc' };

@Injectable()
export class SubsidiariesService {
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

    const where: Prisma.SubsidiaryWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.subsidiary.count({ where }),
      this.prisma.subsidiary.findMany({
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
    return this.prisma.subsidiary.findMany({
      where: { isDelete: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, fullName: true, oracleId: true },
    });
  }

  // Most recent created_at — used as the "last sync" timestamp.
  async getLastSyncAt() {
    const latest = await this.prisma.subsidiary.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(s: SubsidiaryRow) {
    return {
      id: s.id,
      oracle_id: s.oracleId,
      name: s.name,
      full_name: s.fullName,
      is_delete: s.isDelete,
      last_modified: s.lastModified,
      created_at: s.createdAt,
    };
  }
}
