import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateComplaintDto } from './dto/create-complaint.dto';

// Actor derived from the JWT (+ active warehouse header for admin).
export interface ComplaintActor {
  userId: number;
  role: string;
  warehouseId: string | null;
}

const MAX_EVIDENCE = 2;
const MAX_EVIDENCE_CHARS = 3_000_000; // ~2MB per image as base64

const listInclude = {
  user: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
} satisfies Prisma.ComplaintInclude;

type ComplaintRow = Prisma.ComplaintGetPayload<{ include: typeof listInclude }>;

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(private prisma: PrismaService) {}

  private scopeWhere(actor: ComplaintActor): Prisma.ComplaintWhereInput {
    // Admin sees all, optionally filtered by the active warehouse. Everyone
    // else sees only their own complaints.
    if (actor.role === 'admin') {
      return actor.warehouseId ? { warehouseId: actor.warehouseId } : {};
    }
    return { userId: actor.userId };
  }

  async create(dto: CreateComplaintDto, actor: ComplaintActor) {
    const evidences = dto.evidences ?? [];
    if (evidences.length > MAX_EVIDENCE) {
      throw new BadRequestException(`At most ${MAX_EVIDENCE} images are allowed`);
    }
    for (const ev of evidences) {
      if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(ev)) {
        throw new BadRequestException('Evidence must be an image');
      }
      if (ev.length > MAX_EVIDENCE_CHARS) {
        throw new BadRequestException('Each image must be at most ~2MB');
      }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.complaint.count({
      where: { complaintNumber: { startsWith: `CMP-${today}` } },
    });
    const seq = String(count + 1).padStart(3, '0');

    const created = await this.prisma.complaint.create({
      data: {
        complaintNumber: `CMP-${today}-${seq}`,
        menuFeature: dto.menuFeature,
        title: dto.title,
        email: dto.email,
        description: dto.description,
        evidences,
        status: 'Open',
        userId: actor.userId,
        warehouseId: actor.warehouseId,
      },
      include: listInclude,
    });
    this.logger.log(`Complaint ${created.complaintNumber} created`);
    return this.serialize(created);
  }

  async findAll(
    query: { page?: number; limit?: number; search?: string; status?: string },
    actor: ComplaintActor,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.ComplaintWhereInput = { ...this.scopeWhere(actor) };
    if (query.status === 'Open' || query.status === 'Solved') {
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { complaintNumber: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
        { menuFeature: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.complaint.count({ where }),
      this.prisma.complaint.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total_page: Math.ceil(total / limit) || 0,
      total_data: total,
      attributes: { page, limit, order_by: 'created_at desc' },
      rows: rows.map((r) => this.serialize(r, false)),
    };
  }

  async findOne(id: string, actor: ComplaintActor) {
    const c = await this.prisma.complaint.findUnique({
      where: { id },
      include: listInclude,
    });
    if (!c) throw new NotFoundException(`Complaint ${id} not found`);
    if (actor.role !== 'admin' && c.userId !== actor.userId) {
      throw new NotFoundException(`Complaint ${id} not found`);
    }
    return this.serialize(c, true);
  }

  // Admin-only (enforced by permission): change status (e.g. to Solved).
  async updateStatus(id: string, status: 'Open' | 'Solved') {
    const c = await this.prisma.complaint.findUnique({ where: { id } });
    if (!c) throw new NotFoundException(`Complaint ${id} not found`);
    const updated = await this.prisma.complaint.update({
      where: { id },
      data: { status },
      include: listInclude,
    });
    return this.serialize(updated, true);
  }

  // withEvidence=false trims the (heavy) base64 payload from list rows.
  private serialize(c: ComplaintRow, withEvidence = true) {
    return {
      id: c.id,
      complaint_number: c.complaintNumber,
      menu_feature: c.menuFeature,
      title: c.title,
      email: c.email,
      description: c.description,
      status: c.status,
      evidence_count: c.evidences.length,
      evidences: withEvidence ? c.evidences : undefined,
      reported_by: c.user?.name ?? null,
      warehouse: c.warehouse,
      created_at: c.createdAt,
    };
  }
}
