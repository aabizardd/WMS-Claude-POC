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
import { CreateMaterialCategoryDto } from './dto/create-material-category.dto';
import { UpdateMaterialCategoryDto } from './dto/update-material-category.dto';

type CategoryOrder = Prisma.MaterialCategoryOrderByWithRelationInput;
const SORTABLE: Record<string, (d: SortDir) => CategoryOrder> = {
  code: (d) => ({ materialCategoryCode: d }),
  name: (d) => ({ materialCategoryName: d }),
  description: (d) => ({ description: d }),
  status: (d) => ({ isActive: d }),
  materials: (d) => ({ materials: { _count: d } }),
};
const DEFAULT_ORDER: CategoryOrder = { materialCategoryCode: 'asc' };

@Injectable()
export class MaterialCategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginatedQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = buildOrderBy(query.sort_by, query.sort_order, SORTABLE, DEFAULT_ORDER);
    const where: Prisma.MaterialCategoryWhereInput = query.search
      ? {
          OR: [
            { materialCategoryCode: { contains: query.search, mode: 'insensitive' } },
            { materialCategoryName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.materialCategory.count({ where }),
      this.prisma.materialCategory.findMany({
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
    return this.prisma.materialCategory.findMany({
      orderBy: { materialCategoryCode: 'asc' },
      select: {
        id: true,
        materialCategoryName: true,
        materialCategoryCode: true,
        isActive: true,
      },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.materialCategory.findUnique({
      where: { id },
    });
    if (!item) throw new NotFoundException(`Category ${id} not found`);
    return item;
  }

  async create(dto: CreateMaterialCategoryDto) {
    try {
      return await this.prisma.materialCategory.create({ data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateMaterialCategoryDto) {
    await this.findOne(id);
    try {
      return await this.prisma.materialCategory.update({
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
      where: { materialCategoryId: id },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `Cannot delete category: used by ${inUse} material(s)`,
      );
    }
    await this.prisma.materialCategory.delete({ where: { id } });
    return { id, deleted: true };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Category code already exists');
    }
    return e;
  }
}
