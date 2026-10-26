import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_SUBSIDIARY_IDS } from '../common/subsidiary-filter';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { OwnershipType, QueryOwnershipDto } from './dto/query-ownership.dto';

// sort_by key -> column of the unioned row set below.
const SORTABLE: Record<string, string> = {
  type: 'type',
  oracle_id: 'oracle_id',
  entity_id: 'entity_id',
  company_name: 'company_name',
  email: 'email',
  phone: 'phone',
  subsidiary_display: 'subsidiary_display',
  last_modified: 'last_modified',
  created_at: 'created_at',
};

export interface OwnershipRow {
  id: string;
  type: OwnershipType;
  oracle_id: string;
  entity_id: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  subsidiary_display: string | null;
  last_modified: Date | null;
  created_at: Date;
}

/**
 * Ownership Setting, as on WMS dev: vendors and customers in one list, told
 * apart by `type`. Both tables stay as they are (they are synced from Oracle
 * separately); this only reads them together so paging and sorting run over
 * the combined set.
 */
@Injectable()
export class OwnershipsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryOwnershipDto, user: AuthUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    // Each half is shown only to users who may read it on its own page.
    const isAdmin = user.role === 'admin';
    const canVendor = isAdmin || user.permissions.includes('vendors:read');
    const canCustomer = isAdmin || user.permissions.includes('customers:read');
    if (!canVendor && !canCustomer) {
      throw new ForbiddenException('You do not have the required permission');
    }
    const wantVendor = canVendor && query.type !== 'Customer';
    const wantCustomer = canCustomer && query.type !== 'Vendor';

    const like = query.search ? `%${query.search}%` : null;
    const searchSql = like
      ? Prisma.sql`AND (company_name ILIKE ${like} OR entity_id ILIKE ${like} OR email ILIKE ${like})`
      : Prisma.empty;

    const parts: Prisma.Sql[] = [];
    if (wantVendor) {
      // Vendors keep the subsidiary allow-list of their own list.
      parts.push(Prisma.sql`
        SELECT id, 'Vendor' AS type, oracle_id, entity_id, company_name, email,
               phone, subsidiary_display, last_modified, created_at
        FROM vendors
        WHERE subsidiary_id IN (${Prisma.join(ALLOWED_SUBSIDIARY_IDS)}) ${searchSql}`);
    }
    if (wantCustomer) {
      parts.push(Prisma.sql`
        SELECT id, 'Customer' AS type, oracle_id, entity_id, company_name, email,
               phone, NULL::text AS subsidiary_display, last_modified, created_at
        FROM customers
        WHERE TRUE ${searchSql}`);
    }

    const attributes = {
      page,
      limit,
      sort_by: query.sort_by ?? null,
      sort_order: query.sort_order ?? null,
    };
    if (parts.length === 0) {
      return { total_page: 0, total_data: 0, attributes, rows: [] };
    }

    const union = Prisma.join(parts, ' UNION ALL ');
    const column = (query.sort_by && SORTABLE[query.sort_by]) || 'created_at';
    const dir = query.sort_by ? (query.sort_order === 'asc' ? 'ASC' : 'DESC') : 'DESC';
    // Column and direction come from the allow-list above, never from input.
    const orderSql = Prisma.raw(`${column} ${dir} NULLS LAST, id ASC`);

    const [count, rows] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (${union}) o`,
      this.prisma.$queryRaw<OwnershipRow[]>`
        SELECT * FROM (${union}) o
        ORDER BY ${orderSql}
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    ]);
    const total = Number(count[0]?.n ?? 0);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes,
      rows,
    };
  }
}
