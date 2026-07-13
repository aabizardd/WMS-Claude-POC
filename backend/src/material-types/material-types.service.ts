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
import { CreateMaterialTypeDto } from './dto/create-material-type.dto';
import { UpdateMaterialTypeDto } from './dto/update-material-type.dto';

type TypeOrder = Prisma.MaterialTypeOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => TypeOrder> = {
  code: (d) => ({ materialTypeCode: d }),
  name: (d) => ({ materialTypeName: d }),
  description: (d) => ({ description: d }),
  status: (d) => ({ isActive: d }),
  materials: (d) => ({ materials: { _count: d } }),
};
const DEFAULT_ORDER: TypeOrder = { materialTypeCode: 'asc' };

@Injectable()
export class MaterialTypesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginatedQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where: Prisma.MaterialTypeWhereInput = query.search
      ? {
          OR: [
            { materialTypeCode: { contains: query.search, mode: 'insensitive' } },
            { materialTypeName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.materialType.count({ where }),
      this.prisma.materialType.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { materials: true } } },
      }),
    ]);
    return { ...paginationMeta(total, page, limit, query), rows };
  }

  // Lightweight lookup for dropdowns.
  options() {
    return this.prisma.materialType.findMany({
      orderBy: { materialTypeCode: 'asc' },
      select: {
        id: true,
        materialTypeName: true,
        materialTypeCode: true,
        isActive: true,
      },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.materialType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Type ${id} not found`);
    return item;
  }

  async create(dto: CreateMaterialTypeDto) {
    try {
      return await this.prisma.materialType.create({ data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateMaterialTypeDto) {
    await this.findOne(id);
    try {
      return await this.prisma.materialType.update({
        where: { id },
        data: dto,
      });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const inUse = await this.prisma.material.count({
      where: { materialTypeId: id },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `Cannot delete type: used by ${inUse} material(s)`,
      );
    }
    await this.prisma.materialType.delete({ where: { id } });
    return { id, deleted: true };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Type code already exists');
    }
    return e;
  }
}
