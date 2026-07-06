import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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

  findAll(scope: WarehouseScope) {
    const where: Prisma.UserWhereInput = {};
    // Non-admins only see users in their warehouse (unchanged). Admins follow
    // the active warehouse from the header selector; "All" (no selection) → all.
    if (scope.role !== 'admin') {
      where.warehouseId = scope.warehouseId ?? '__no_warehouse__';
    } else if (scope.warehouseId) {
      where.warehouseId = scope.warehouseId;
    }
    return this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { id: 'asc' },
    });
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

  async create(dto: CreateUserDto) {
    await this.ensureRoleExists(dto.roleId);
    await this.ensureWarehouseExists(dto.warehouseId);
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
          isActive: dto.isActive ?? true,
        },
        select: userSelect,
      });
    } catch (e) {
      throw this.handlePrismaError(e);
    }
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
