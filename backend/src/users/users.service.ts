import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';

type UserOrder = Prisma.UserOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => UserOrder> = {
  name: (d) => ({ name: d }),
  username: (d) => ({ username: d }),
  email: (d) => ({ email: d }),
  is_active: (d) => ({ isActive: d }),
  role: (d) => ({ role: { name: d } }),
  warehouse: (d) => ({ warehouse: { name: d } }),
  created_at: (d) => ({ createdAt: d }),
};
const DEFAULT_ORDER: UserOrder = { id: 'asc' };

// Never return the password hash to clients
const userSelect = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  isActive: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  warehouseId: true,
  warehouse: { select: { id: true, name: true } },
  departmentId: true,
  department: { select: { id: true, name: true } },
  subsidiaryId: true,
  subsidiary: { select: { id: true, name: true, fullName: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// Used to scope reads/writes to the current user's warehouse (admin bypasses).
export interface WarehouseScope {
  role: string;
  warehouseId: string | null;
}

// Display name derived from first/last; fall back to a provided default.
function buildName(
  firstName?: string | null,
  lastName?: string | null,
  fallback = '',
) {
  const joined = [firstName, lastName].filter(Boolean).join(' ').trim();
  return joined || fallback;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(scope: WarehouseScope, query: QueryUserDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      SORTABLE,
      DEFAULT_ORDER,
    );

    const where: Prisma.UserWhereInput = {};
    // Non-admins only see users in their warehouse (unchanged). Admins follow
    // the active warehouse from the header selector; "All" (no selection) → all.
    if (scope.role !== 'admin') {
      where.warehouseId = scope.warehouseId ?? '__no_warehouse__';
    } else if (scope.warehouseId) {
      where.warehouseId = scope.warehouseId;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: userSelect,
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
      rows,
    };
  }

  findPickers(warehouseId?: string) {
    const where: any = { isActive: true, role: { name: 'picker' } };
    if (warehouseId) where.warehouseId = warehouseId;
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number, scope?: WarehouseScope) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (
      !user ||
      (scope && scope.role !== 'admin' && user.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async create(dto: CreateUserDto, actor?: WarehouseScope) {
    // Non-admins cannot assign the admin (super-admin) role, and the new user
    // is always scoped to the creator's own warehouse (from their token / /me).
    if (actor && actor.role !== 'admin') {
      await this.ensureNotAdminRole(dto.roleId);
      if (actor.warehouseId) dto = { ...dto, warehouseId: actor.warehouseId };
    }
    await this.ensureRoleExists(dto.roleId);
    await this.ensureWarehouseExists(dto.warehouseId);
    const org = await this.resolveOrg(dto.departmentId, dto.subsidiaryId);
    const password = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.user.create({
        data: {
          name: buildName(dto.firstName, dto.lastName, dto.username),
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          email: dto.email,
          username: dto.username,
          password,
          roleId: dto.roleId,
          warehouseId: dto.warehouseId,
          departmentId: org.departmentId,
          subsidiaryId: org.subsidiaryId,
          isActive: dto.isActive ?? true,
        },
        select: userSelect,
      });
    } catch (e) {
      throw this.handlePrismaError(e);
    }
  }

  // Validate the department/subsidiary combination and return the ids to store.
  // Rules: subsidiary requires a department; subsidiary must belong to the
  // department (department.subsidiaryId is a comma-joined list of subsidiary
  // oracle ids). Clearing the department also clears the subsidiary.
  private async resolveOrg(
    departmentId?: string | null,
    subsidiaryId?: string | null,
  ): Promise<{ departmentId: string | null; subsidiaryId: string | null }> {
    const dept = departmentId ?? null;
    const sub = subsidiaryId ?? null;

    if (!dept) {
      // No department -> subsidiary must be empty too.
      if (sub) {
        throw new BadRequestException(
          'Select a department before choosing a subsidiary',
        );
      }
      return { departmentId: null, subsidiaryId: null };
    }

    const department = await this.prisma.department.findUnique({
      where: { id: dept },
      select: { subsidiaryId: true },
    });
    if (!department) {
      throw new BadRequestException('Selected department does not exist');
    }
    if (!sub) return { departmentId: dept, subsidiaryId: null };

    const subsidiary = await this.prisma.subsidiary.findUnique({
      where: { id: sub },
      select: { oracleId: true },
    });
    if (!subsidiary) {
      throw new BadRequestException('Selected subsidiary does not exist');
    }
    const allowed = (department.subsidiaryId ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(subsidiary.oracleId)) {
      throw new BadRequestException(
        'Subsidiary does not belong to the selected department',
      );
    }
    return { departmentId: dept, subsidiaryId: sub };
  }

  async update(id: number, dto: UpdateUserDto, scope?: WarehouseScope) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (
      !existing ||
      (scope &&
        scope.role !== 'admin' &&
        existing.warehouseId !== scope.warehouseId)
    ) {
      throw new NotFoundException(`User ${id} not found`);
    }
    // Non-admins cannot assign the admin role, nor move a user out of their own
    // warehouse (the warehouse stays scoped to the editor's warehouse).
    if (scope && scope.role !== 'admin') {
      if (dto.roleId !== undefined) await this.ensureNotAdminRole(dto.roleId);
      if (scope.warehouseId) dto = { ...dto, warehouseId: scope.warehouseId };
    }
    if (dto.roleId !== undefined) {
      await this.ensureRoleExists(dto.roleId);
    }
    if (dto.warehouseId) {
      await this.ensureWarehouseExists(dto.warehouseId);
    }

    const data: Prisma.UserUpdateInput = {
      email: dto.email,
      username: dto.username,
      isActive: dto.isActive,
    };

    // Recompute the display name when first/last name change.
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      const firstName = dto.firstName ?? existing.firstName;
      const lastName = dto.lastName ?? existing.lastName;
      data.firstName = firstName;
      data.lastName = lastName;
      data.name = buildName(firstName, lastName, existing.name);
    }

    if (dto.roleId !== undefined) {
      data.role = { connect: { id: dto.roleId } };
    }
    // Warehouse is required; connect when provided on update.
    if (dto.warehouseId) {
      data.warehouse = { connect: { id: dto.warehouseId } };
    }

    // Department / subsidiary — validated together as a combination. When a
    // department changes, the (reset) subsidiary is re-validated against it.
    if (dto.departmentId !== undefined || dto.subsidiaryId !== undefined) {
      const finalDept =
        dto.departmentId !== undefined
          ? dto.departmentId
          : existing.departmentId;
      const finalSub =
        dto.subsidiaryId !== undefined
          ? dto.subsidiaryId
          : existing.subsidiaryId;
      const org = await this.resolveOrg(finalDept, finalSub);
      data.department = org.departmentId
        ? { connect: { id: org.departmentId } }
        : { disconnect: true };
      data.subsidiary = org.subsidiaryId
        ? { connect: { id: org.subsidiaryId } }
        : { disconnect: true };
    }

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: userSelect,
      });
    } catch (e) {
      throw this.handlePrismaError(e);
    }
  }

  async remove(id: number, scope?: WarehouseScope) {
    await this.findOne(id, scope);
    await this.prisma.user.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async ensureRoleExists(roleId: number) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException(`Role ${roleId} does not exist`);
    }
  }

  // Guard: only an admin may assign the admin (super-admin) role.
  private async ensureNotAdminRole(roleId: number) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { name: true },
    });
    if (role?.name === 'admin') {
      throw new ForbiddenException('You cannot assign the admin role');
    }
  }

  private async ensureWarehouseExists(warehouseId?: string | null) {
    if (!warehouseId) return;
    const wh = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });
    if (!wh) {
      throw new BadRequestException('Selected warehouse does not exist');
    }
  }

  private handlePrismaError(e: unknown) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const target = (e.meta?.target as string[])?.join(', ') ?? 'field';
      return new BadRequestException(`${target} already in use`);
    }
    return e;
  }
}
