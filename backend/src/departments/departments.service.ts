import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type DepartmentRow = Prisma.DepartmentGetPayload<object>;

type DepartmentOrder = Prisma.DepartmentOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => DepartmentOrder> = {
  oracle_id: (d) => ({ oracleId: d }),
  name: (d) => ({ name: d }),
  parent_name: (d) => ({ parentName: d }),
  subsidiary_name: (d) => ({ subsidiaryName: d }),
  is_inactive: (d) => ({ isInactive: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: DepartmentOrder = { createdAt: 'desc' };

@Injectable()
export class DepartmentsService {
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

    const where: Prisma.DepartmentWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { parentName: { contains: query.search, mode: 'insensitive' } },
            { subsidiaryName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.department.count({ where }),
      this.prisma.department.findMany({
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
    return this.prisma.department.findMany({
      where: { isInactive: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, oracleId: true },
    });
  }

  // Subsidiaries that belong to a department (department.subsidiaryId is a
  // comma-joined list of subsidiary oracle ids). Used by the User form to
  // filter the subsidiary dropdown by the chosen department.
  async subsidiaryOptions(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      select: { subsidiaryId: true },
    });
    const ids = (dept?.subsidiaryId ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return [];
    return this.prisma.subsidiary.findMany({
      where: { oracleId: { in: ids }, isDelete: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, fullName: true, oracleId: true },
    });
  }

  // Most recent created_at — used as the "last sync" timestamp.
  async getLastSyncAt() {
    const latest = await this.prisma.department.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(d: DepartmentRow) {
    return {
      id: d.id,
      oracle_id: d.oracleId,
      name: d.name,
      is_inactive: d.isInactive,
      parent_id: d.parentId,
      parent_name: d.parentName,
      subsidiary_id: d.subsidiaryId,
      subsidiary_name: d.subsidiaryName,
      last_modified: d.lastModified,
      created_at: d.createdAt,
    };
  }
}
