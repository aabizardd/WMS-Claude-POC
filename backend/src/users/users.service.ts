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
import { inScope, type WarehouseScope } from '../common/warehouse-scope';
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
  employee_id: (d) => ({ employeeId: d }),
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
  employeeId: true,
  isActive: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  warehouses: {
    select: { warehouse: { select: { id: true, name: true } } },
    orderBy: { warehouse: { name: 'asc' } },
  },
  departmentId: true,
  department: { select: { id: true, name: true } },
  subsidiaryId: true,
  subsidiary: { select: { id: true, name: true, fullName: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** The client shape: the assigned warehouses flattened, plus their ids. */
function toUser({ warehouses, ...u }: UserRow) {
  const list = warehouses.map((w) => w.warehouse);
  return { ...u, warehouseIds: list.map((w) => w.id), warehouses: list };
}

/** Users assigned to any of the scope's warehouses (`{}` = no limit). */
function userScopeWhere(scope: WarehouseScope): Prisma.UserWhereInput {
  if (!scope.warehouseIds) return {};
  return { warehouses: { some: { warehouseId: { in: scope.warehouseIds } } } };
}

// Blank employee ids are stored as null, so several users may leave it empty.
export function cleanEmployeeId(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// "Username already in use", etc. — from a unique-constraint error.
export function uniqueViolation(e: Prisma.PrismaClientKnownRequestError) {
  const LABELS: Record<string, string> = {
    username: 'Username',
    email: 'Email',
    employee_id: 'Employee ID',
    employeeId: 'Employee ID',
  };
  const target = (e.meta?.target as string[] | undefined) ?? [];
  const label = target.map((t) => LABELS[t] ?? t).join(', ') || 'Value';
  return new BadRequestException(`${label} already in use`);
}

// Display name derived from first/last; fall back to a provided default.
export function buildName(
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

    // Non-admins see the users sharing one of their warehouses. Admins follow
    // the active warehouse from the header selector; "All" (no selection) → all.
    const where: Prisma.UserWhereInput = userScopeWhere(scope);
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { employeeId: { contains: query.search, mode: 'insensitive' } },
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
      rows: rows.map(toUser),
    };
  }

  findPickers(warehouseId?: string) {
    const where: Prisma.UserWhereInput = { isActive: true, role: { name: 'picker' } };
    if (warehouseId) where.warehouses = { some: { warehouseId } };
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
    if (!user || (scope && !this.sharesWarehouse(user, scope))) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return toUser(user);
  }

  // A non-admin may manage a user who shares at least one of their warehouses.
  private sharesWarehouse(
    user: { warehouses: { warehouse: { id: string } }[] },
    scope: WarehouseScope,
  ) {
    if (scope.role === 'admin') return true;
    return user.warehouses.some((w) => inScope(scope, w.warehouse.id));
  }

  /**
   * The warehouses to save. A non-admin may only hand out warehouses they hold
   * themselves; an edit keeps the target's warehouses the editor cannot see.
   */
  private resolveWarehouses(
    requested: string[],
    scope: WarehouseScope | undefined,
    current: string[] = [],
  ): string[] {
    const ids = [...new Set(requested)];
    if (!scope || scope.role === 'admin') return ids;
    const outside = ids.filter((id) => !inScope(scope, id));
    if (outside.length) {
      throw new ForbiddenException('You can only assign warehouses you are assigned to');
    }
    return [...new Set([...current.filter((id) => !inScope(scope, id)), ...ids])];
  }

  async create(dto: CreateUserDto, actor?: WarehouseScope) {
    // Non-admins cannot assign the admin (super-admin) role, nor a warehouse
    // they are not assigned to themselves.
    if (actor && actor.role !== 'admin') {
      await this.ensureNotAdminRole(dto.roleId);
    }
    const warehouseIds = this.resolveWarehouses(dto.warehouseIds, actor);
    await this.ensureRoleExists(dto.roleId);
    await this.ensureWarehousesExist(warehouseIds);
    const org = await this.resolveOrg(dto.departmentId, dto.subsidiaryId);
    const password = await bcrypt.hash(dto.password, 10);
    try {
      const created = await this.prisma.user.create({
        data: {
          name: buildName(dto.firstName, dto.lastName, dto.username),
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          email: dto.email,
          username: dto.username,
          employeeId: cleanEmployeeId(dto.employeeId),
          password,
          roleId: dto.roleId,
          warehouses: { create: warehouseIds.map((warehouseId) => ({ warehouseId })) },
          departmentId: org.departmentId,
          subsidiaryId: org.subsidiaryId,
          isActive: dto.isActive ?? true,
        },
        select: userSelect,
      });
      return toUser(created);
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
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { warehouses: { select: { warehouse: { select: { id: true } } } } },
    });
    if (!existing || (scope && !this.sharesWarehouse(existing, scope))) {
      throw new NotFoundException(`User ${id} not found`);
    }
    // Non-admins cannot assign the admin role, nor warehouses they do not hold.
    if (scope && scope.role !== 'admin' && dto.roleId !== undefined) {
      await this.ensureNotAdminRole(dto.roleId);
    }
    if (dto.roleId !== undefined) {
      await this.ensureRoleExists(dto.roleId, existing.roleId);
    }
    const warehouseIds = dto.warehouseIds
      ? this.resolveWarehouses(
          dto.warehouseIds,
          scope,
          existing.warehouses.map((w) => w.warehouse.id),
        )
      : undefined;
    if (warehouseIds) await this.ensureWarehousesExist(warehouseIds);

    const data: Prisma.UserUpdateInput = {
      email: dto.email,
      username: dto.username,
      employeeId:
        dto.employeeId === undefined ? undefined : cleanEmployeeId(dto.employeeId),
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
    // Replace the assignments when provided (at least one, checked by the DTO).
    if (warehouseIds) {
      data.warehouses = {
        deleteMany: {},
        create: warehouseIds.map((warehouseId) => ({ warehouseId })),
      };
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
      const updated = await this.prisma.user.update({
        where: { id },
        data,
        select: userSelect,
      });
      return toUser(updated);
    } catch (e) {
      throw this.handlePrismaError(e);
    }
  }

  async remove(id: number, scope?: WarehouseScope) {
    await this.findOne(id, scope);
    await this.prisma.user.delete({ where: { id } });
    return { id, deleted: true };
  }

  // `currentRoleId`: on an update, keeping a role that has since been set
  // inactive is allowed; only (re)assigning an inactive role is refused.
  private async ensureRoleExists(roleId: number, currentRoleId?: number) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException(`Role ${roleId} does not exist`);
    }
    if (!role.isActive && roleId !== currentRoleId) {
      throw new BadRequestException(`Role "${role.name}" is inactive and cannot be assigned`);
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

  private async ensureWarehousesExist(warehouseIds: string[]) {
    const found = await this.prisma.warehouse.count({
      where: { id: { in: warehouseIds } },
    });
    if (found !== warehouseIds.length) {
      throw new BadRequestException('Selected warehouse does not exist');
    }
  }

  private handlePrismaError(e: unknown) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return uniqueViolation(e);
    }
    return e;
  }
}
