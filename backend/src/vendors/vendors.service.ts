import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { subsidiarySingleFilter } from '../common/subsidiary-filter';

type VendorRow = Prisma.VendorGetPayload<object>;

type VendorOrder = Prisma.VendorOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => VendorOrder> = {
  oracle_id: (d) => ({ oracleId: d }),
  entity_id: (d) => ({ entityId: d }),
  company_name: (d) => ({ companyName: d }),
  email: (d) => ({ email: d }),
  phone: (d) => ({ phone: d }),
  subsidiary_display: (d) => ({ subsidiaryDisplay: d }),
  last_modified: (d) => ({ lastModified: d }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: VendorOrder = { createdAt: 'desc' };

@Injectable()
export class VendorsService {
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

    const where: Prisma.VendorWhereInput = {
      // Only vendors within the allowed subsidiary are visible.
      subsidiaryId: subsidiarySingleFilter(),
    };
    if (query.search) {
      where.OR = [
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({
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
    return this.prisma.vendor.findMany({
      where: { subsidiaryId: subsidiarySingleFilter() },
      orderBy: { companyName: 'asc' },
      select: { id: true, companyName: true, entityId: true, oracleId: true },
    });
  }

  // Most recent created_at — used as the "last sync" timestamp.
  async getLastSyncAt() {
    const latest = await this.prisma.vendor.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  private serialize(v: VendorRow) {
    return {
      id: v.id,
      oracle_id: v.oracleId,
      entity_id: v.entityId,
      company_name: v.companyName,
      email: v.email,
      phone: v.phone,
      terms: v.terms,
      terms_display: v.termsDisplay,
      subsidiary: v.subsidiaryId,
      subsidiary_display: v.subsidiaryDisplay,
      last_modified: v.lastModified,
      created_at: v.createdAt,
    };
  }
}
