import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';

const roleInclude = {
  _count: { select: { users: true } },
  permissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude;

type RoleWithRelations = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

type RoleOrder = Prisma.RoleOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => RoleOrder> = {
  name: (d) => ({ name: d }),
  description: (d) => ({ description: d }),
  users: (d) => ({ users: { _count: d } }),
  permissions: (d) => ({ permissions: { _count: d } }),
};
const DEFAULT_ORDER: RoleOrder = { id: 'asc' };

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryRoleDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(
      query.sort_by,
      query.sort_order,
      SORTABLE,
      DEFAULT_ORDER,
    );

    const where: Prisma.RoleWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, roles] = await this.prisma.$transaction([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        orderBy,
        include: roleInclude,
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
      rows: roles.map((r) => this.serialize(r)),
    };
  }

  // Lightweight lookup for dropdowns (id + name only).
  options() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  async findOne(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: roleInclude,
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return this.serialize(role);
  }

  async create(dto: CreateRoleDto) {
    await this.validatePermissions(dto.permissionIds);
    try {
      const role = await this.prisma.role.create({
        data: {
          name: dto.name,
          description: dto.description,
          permissions: dto.permissionIds?.length
            ? {
                create: dto.permissionIds.map((permissionId) => ({
                  permissionId,
                })),
              }
            : undefined,
        },
        include: roleInclude,
      });
      return this.serialize(role);
    } catch (e) {
      throw this.handlePrismaError(e);
    }
  }

  async update(id: number, dto: UpdateRoleDto) {
    await this.ensureExists(id);
    await this.validatePermissions(dto.permissionIds);

    try {
      // Replace the permission set when permissionIds is provided.
      const role = await this.prisma.$transaction(async (tx) => {
        await tx.role.update({
          where: { id },
          data: { name: dto.name, description: dto.description },
        });

        if (dto.permissionIds) {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          if (dto.permissionIds.length) {
            await tx.rolePermission.createMany({
              data: dto.permissionIds.map((permissionId) => ({
                roleId: id,
                permissionId,
              })),
              skipDuplicates: true,
            });
          }
        }

        return tx.role.findUniqueOrThrow({
          where: { id },
          include: roleInclude,
        });
      });
      return this.serialize(role);
    } catch (e) {
      throw this.handlePrismaError(e);
    }
  }

  async remove(id: number) {
    await this.ensureExists(id);
    const usersWithRole = await this.prisma.user.count({
      where: { roleId: id },
    });
    if (usersWithRole > 0) {
      throw new BadRequestException(
        `Cannot delete role: ${usersWithRole} user(s) still assigned to it`,
      );
    }
    // role_permissions rows are removed via onDelete: Cascade.
    await this.prisma.role.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------- helpers ----------

  private async ensureExists(id: number) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
  }

  private async validatePermissions(permissionIds?: string[]) {
    if (!permissionIds || permissionIds.length === 0) return;
    const ids = [...new Set(permissionIds)];
    const found = await this.prisma.permission.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException('One or more permissions are invalid');
    }
  }

  private serialize(role: RoleWithRelations) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      userCount: role._count.users,
      permissions: role.permissions.map((rp) => ({
        id: rp.permission.id,
        key: rp.permission.key,
        resource: rp.permission.resource,
        action: rp.permission.action,
      })),
      permissionIds: role.permissions.map((rp) => rp.permission.id),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private handlePrismaError(e: unknown) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new BadRequestException('Role name already exists');
    }
    return e;
  }
}
