import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';

type CustomerRow = Prisma.CustomerGetPayload<object>;

type CustomerOrder = Prisma.CustomerOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => CustomerOrder> = {
  oracle_id: (d) => ({ oracleId: d }),
  entity_id: (d) => ({ entityId: d }),
  company_name: (d) => ({ companyName: d }),
  email: (d) => ({ email: d }),
  phone: (d) => ({ phone: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: CustomerOrder = { createdAt: 'desc' };

@Injectable()
export class CustomersService {
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

    const where: Prisma.CustomerWhereInput = query.search
      ? {
          OR: [
            { companyName: { contains: query.search, mode: 'insensitive' } },
            { entityId: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
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
    return this.prisma.customer.findMany({
      orderBy: { companyName: 'asc' },
      select: { id: true, companyName: true, entityId: true, oracleId: true },
    });
  }

  // Most recent created_at — used as the "last sync" timestamp.
  async getLastSyncAt() {
    const latest = await this.prisma.customer.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(c: CustomerRow) {
    return {
      id: c.id,
      oracle_id: c.oracleId,
      entity_id: c.entityId,
      company_name: c.companyName,
      email: c.email,
      phone: c.phone,
      last_modified: c.lastModified,
      created_at: c.createdAt,
    };
  }
}
