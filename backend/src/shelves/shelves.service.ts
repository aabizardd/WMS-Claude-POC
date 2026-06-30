import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShelfDto } from './dto/create-shelf.dto';
import { UpdateShelfDto } from './dto/update-shelf.dto';

@Injectable()
export class ShelvesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.shelf.findMany({
      orderBy: { shelfCode: 'asc' },
      include: { _count: { select: { bins: true } } },
    });
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
