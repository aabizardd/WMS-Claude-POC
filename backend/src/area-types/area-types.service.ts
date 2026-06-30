import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAreaTypeDto } from './dto/create-area-type.dto';
import { UpdateAreaTypeDto } from './dto/update-area-type.dto';

@Injectable()
export class AreaTypesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.areaType.findMany({
      orderBy: { areaTypeCode: 'asc' },
      include: { _count: { select: { bins: true } } },
    });
  }

  options() {
    return this.prisma.areaType.findMany({
      orderBy: { areaTypeCode: 'asc' },
      select: { id: true, areaTypeName: true, areaTypeCode: true, isActive: true },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.areaType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Area type ${id} not found`);
    return item;
  }

  async create(dto: CreateAreaTypeDto) {
    try {
      return await this.prisma.areaType.create({ data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async update(id: string, dto: UpdateAreaTypeDto) {
    await this.findOne(id);
    try {
      return await this.prisma.areaType.update({ where: { id }, data: dto });
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const inUse = await this.prisma.bin.count({ where: { areaTypeId: id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `Cannot delete area type: used by ${inUse} bin(s)`,
      );
    }
    await this.prisma.areaType.delete({ where: { id } });
    return { id, deleted: true };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Area type code already exists');
    }
    return e;
  }
}
