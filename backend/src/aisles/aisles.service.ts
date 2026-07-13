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
import { CreateAisleDto } from './dto/create-aisle.dto';
import { UpdateAisleDto } from './dto/update-aisle.dto';

type AisleOrder = Prisma.AisleOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => AisleOrder> = {
  code: (d) => ({ aisleCode: d }),
  name: (d) => ({ aisleName: d }),
  status: (d) => ({ isActive: d }),
  bins: (d) => ({ bins: { _count: d } }),
};
const DEFAULT_ORDER: AisleOrder = { aisleCode: 'asc' };

@Injectable()
export class AislesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginatedQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where: Prisma.AisleWhereInput = query.search
      ? {
          OR: [
            { aisleCode: { contains: query.search, mode: 'insensitive' } },
            { aisleName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aisle.count({ where }),
      this.prisma.aisle.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { bins: true } } },
      }),
    ]);
    return { ...paginationMeta(total, page, limit, query), rows };
  }

  options() {
    return this.prisma.aisle.findMany({
      orderBy: { aisleCode: 'asc' },
      select: { id: true, aisleName: true, aisleCode: true, isActive: true },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.aisle.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Aisle ${id} not found`);
    return item;
  }

  async create(dto: CreateAisleDto) {
    try {
      return await this.prisma.aisle.create({ data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateAisleDto) {
    await this.findOne(id);
    try {
      return await this.prisma.aisle.update({ where: { id }, data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const inUse = await this.prisma.bin.count({ where: { aisleId: id } });
    if (inUse > 0) {
      throw new BadRequestException(`Cannot delete aisle: used by ${inUse} bin(s)`);
    }
    await this.prisma.aisle.delete({ where: { id } });
    return { id, deleted: true };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Aisle code already exists');
    }
    return e;
  }
}
