import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type VendorRow = Prisma.VendorGetPayload<object>;

const ORDER_FIELD_MAP: Record<string, keyof Prisma.VendorOrderByWithRelationInput> =
  {
    created_at: 'createdAt',
    company_name: 'companyName',
    entity_id: 'entityId',
    last_modified: 'lastModified',
  };

@Injectable()
export class VendorsService {
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

    const where: Prisma.VendorWhereInput = query.search
      ? {
          OR: [
            { companyName: { contains: query.search, mode: 'insensitive' } },
            { entityId: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

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
      attributes: { page, limit, order_by: query.order_by ?? 'created_at desc' },
      rows: rows.map((r) => this.serialize(r)),
    };
  }

  // Lightweight lookup for dropdowns.
  options() {
    return this.prisma.vendor.findMany({
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

  private parseOrderBy(
    orderByStr: string,
  ): Prisma.VendorOrderByWithRelationInput {
    const [rawField, rawDir] = orderByStr.trim().split(/\s+/);
    const field = ORDER_FIELD_MAP[rawField] ?? 'createdAt';
    const dir: Prisma.SortOrder = rawDir === 'asc' ? 'asc' : 'desc';
    return { [field]: dir };
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
