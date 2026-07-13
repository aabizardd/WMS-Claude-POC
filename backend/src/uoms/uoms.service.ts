import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderBy, type SortDir } from '../common/sort.util';
import { paginationMeta } from '../common/pagination';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import { CreateUomDto } from './dto/create-uom.dto';
import { UpdateUomDto } from './dto/update-uom.dto';

type UomOrder = Prisma.UomOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => UomOrder> = {
  code: (d) => ({ uomCode: d }),
  name: (d) => ({ uomName: d }),
  status: (d) => ({ isActive: d }),
};
const DEFAULT_ORDER: UomOrder = { uomCode: 'asc' };

@Injectable()
export class UomsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginatedQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where: Prisma.UomWhereInput = query.search
      ? {
          OR: [
            { uomCode: { contains: query.search, mode: 'insensitive' } },
            { uomName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.uom.count({ where }),
      this.prisma.uom.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { ...paginationMeta(total, page, limit, query), rows };
  }

  // Lightweight lookup for dropdowns.
  options() {
    return this.prisma.uom.findMany({
      orderBy: { uomCode: 'asc' },
      select: { id: true, uomName: true, uomCode: true, isActive: true },
    });
  }

  async findOne(id: string) {
    const uom = await this.prisma.uom.findUnique({ where: { id } });
    if (!uom) throw new NotFoundException(`UOM ${id} not found`);
    return uom;
  }

  async create(dto: CreateUomDto) {
    try {
      return await this.prisma.uom.create({ data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateUomDto) {
    await this.findOne(id);
    try {
      return await this.prisma.uom.update({ where: { id }, data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const inUse = await this.prisma.material.count({
      where: {
        OR: [
          { primaryUomId: id },
          { secondaryUomId: id },
          { weightUomId: id },
          { dimensionUomId: id },
        ],
      },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `Cannot delete UOM: used by ${inUse} material(s)`,
      );
    }
    await this.prisma.uom.delete({ where: { id } });
    return { id, deleted: true };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('UOM code already exists');
    }
    return e;
  }
}
