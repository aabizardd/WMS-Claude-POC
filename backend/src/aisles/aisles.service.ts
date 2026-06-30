import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAisleDto } from './dto/create-aisle.dto';
import { UpdateAisleDto } from './dto/update-aisle.dto';

@Injectable()
export class AislesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.aisle.findMany({
      orderBy: { aisleCode: 'asc' },
      include: { _count: { select: { bins: true } } },
    });
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
