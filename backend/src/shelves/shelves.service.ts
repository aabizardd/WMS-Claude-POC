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
import { CreateShelfDto } from './dto/create-shelf.dto';
import { UpdateShelfDto } from './dto/update-shelf.dto';

type ShelfOrder = Prisma.ShelfOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => ShelfOrder> = {
  code: (d) => ({ shelfCode: d }),
  name: (d) => ({ shelfLabel: d }),
  status: (d) => ({ isActive: d }),
  bins: (d) => ({ bins: { _count: d } }),
};
const DEFAULT_ORDER: ShelfOrder = { shelfCode: 'asc' };

@Injectable()
export class ShelvesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginatedQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where: Prisma.ShelfWhereInput = query.search
      ? {
          OR: [
            { shelfCode: { contains: query.search, mode: 'insensitive' } },
            { shelfLabel: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.shelf.count({ where }),
      this.prisma.shelf.findMany({
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
    return this.prisma.shelf.findMany({
      orderBy: { shelfCode: 'asc' },
      select: { id: true, shelfLabel: true, shelfCode: true, isActive: true },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.shelf.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Shelf ${id} not found`);
    return item;
  }

  async create(dto: CreateShelfDto) {
    try {
      return await this.prisma.shelf.create({ data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateShelfDto) {
    await this.findOne(id);
    try {
      return await this.prisma.shelf.update({ where: { id }, data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const inUse = await this.prisma.bin.count({ where: { shelfId: id } });
    if (inUse > 0) {
      throw new BadRequestException(`Cannot delete shelf: used by ${inUse} bin(s)`);
    }
    await this.prisma.shelf.delete({ where: { id } });
    return { id, deleted: true };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Shelf code already exists');
    }
    return e;
  }
}
