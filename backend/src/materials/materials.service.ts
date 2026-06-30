import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { QueryMaterialDto } from './dto/query-material.dto';

// Pull in the relations needed to build the API response
const materialInclude = {
  materialCategory: true,
  materialType: true,
  primaryUom: true,
  secondaryUom: true,
  weightUom: true,
  dimensionUom: true,
} satisfies Prisma.MaterialInclude;

type MaterialWithRelations = Prisma.MaterialGetPayload<{
  include: typeof materialInclude;
}>;

// Map "<field> <dir>" (snake_case) to a Prisma orderBy clause
const ORDER_FIELD_MAP: Record<string, keyof Prisma.MaterialOrderByWithRelationInput> =
  {
    created_at: 'createdAt',
    modified_at: 'updatedAt',
    material_name: 'materialName',
    material_code: 'materialCode',
  };

@Injectable()
export class MaterialsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryMaterialDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const orderBy = this.parseOrderBy(query.order_by ?? 'created_at desc');

    const where: Prisma.MaterialWhereInput = query.search
      ? {
          OR: [
            { materialName: { contains: query.search, mode: 'insensitive' } },
            { materialCode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.material.count({ where }),
      this.prisma.material.findMany({
        where,
        include: materialInclude,
        orderBy,
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
        order_by: query.order_by ?? 'created_at desc',
      },
      rows: rows.map((r) => this.serialize(r)),
    };
  }

  async findOne(id: string) {
    const material = await this.prisma.material.findUnique({
      where: { id },
      include: materialInclude,
    });
    if (!material) throw new NotFoundException(`Material ${id} not found`);
    return this.serialize(material);
  }

  // Most recent created_at among ERP-synced materials — used as the
  // "last sync" timestamp so the next incremental sync starts from there.
  async getLastSyncAt() {
    const latest = await this.prisma.material.findFirst({
      where: { erpDocId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return { lastSyncAt: latest?.createdAt ?? null };
  }

  async update(id: string, dto: UpdateMaterialDto, actor?: string) {
    const existing = await this.prisma.material.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Material ${id} not found`);
    await this.validateRefs(dto);

    // For ERP-synced materials, code & name are owned by Oracle and stay
    // locked; every other field can still be edited in WMS.
    const fromErp = !!existing.erpDocId;
    const data: Prisma.MaterialUncheckedUpdateInput = {
      materialCategoryId: dto.materialCategoryId,
      materialTypeId: dto.materialTypeId,
      ...this.optionalData(dto),
      modifiedBy: actor,
    };
    if (!fromErp) {
      data.materialName = dto.materialName;
      data.materialCode = dto.materialCode;
    }

    try {
      const updated = await this.prisma.material.update({
        where: { id },
        data,
        include: materialInclude,
      });
      return this.serialize(updated);
    } catch (e) {
      throw this.handle(e);
    }
  }

  // ---------- helpers ----------

  private optionalData(dto: UpdateMaterialDto) {
    return {
      primaryUomId: dto.primaryUomId ?? null,
      secondaryUomId: dto.secondaryUomId ?? null,
      weightUomId: dto.weightUomId ?? null,
      dimensionUomId: dto.dimensionUomId ?? null,
      conversionRateQuantity: dto.conversionRateQuantity,
      currency: dto.currency ?? null,
      materialLength: dto.materialLength,
      materialWidth: dto.materialWidth,
      materialHeight: dto.materialHeight,
      materialWeight: dto.materialWeight,
      materialQty: dto.materialQty,
      photos: dto.photos,
      isActive: dto.isActive,
    };
  }

  private async validateRefs(dto: UpdateMaterialDto) {
    if (dto.materialCategoryId) {
      const c = await this.prisma.materialCategory.findUnique({
        where: { id: dto.materialCategoryId },
      });
      if (!c) throw new BadRequestException('Invalid material category');
    }
    if (dto.materialTypeId) {
      const t = await this.prisma.materialType.findUnique({
        where: { id: dto.materialTypeId },
      });
      if (!t) throw new BadRequestException('Invalid material type');
    }
    const uomIds = [
      dto.primaryUomId,
      dto.secondaryUomId,
      dto.weightUomId,
      dto.dimensionUomId,
    ].filter(Boolean) as string[];
    if (uomIds.length) {
      const found = await this.prisma.uom.count({
        where: { id: { in: uomIds } },
      });
      if (found !== new Set(uomIds).size) {
        throw new BadRequestException('One or more UOM references are invalid');
      }
    }
  }

  private parseOrderBy(
    orderByStr: string,
  ): Prisma.MaterialOrderByWithRelationInput {
    const [rawField, rawDir] = orderByStr.trim().split(/\s+/);
    const field = ORDER_FIELD_MAP[rawField] ?? 'createdAt';
    const dir: Prisma.SortOrder = rawDir === 'asc' ? 'asc' : 'desc';
    return { [field]: dir };
  }

  // Shape the entity into the original API response format
  private serialize(m: MaterialWithRelations) {
    const uom = (u: { id: string; uomName: string; uomCode: string } | null) =>
      u ? { id: u.id, uom_name: u.uomName, uom_code: u.uomCode } : {};

    return {
      id: m.id,
      erp_doc_id: m.erpDocId,
      conversion_rate_quantity: m.conversionRateQuantity,
      currency: m.currency,
      material_category: m.materialCategory
        ? {
            id: m.materialCategory.id,
            material_category_name: m.materialCategory.materialCategoryName,
            material_category_code: m.materialCategory.materialCategoryCode,
          }
        : {},
      material_type: m.materialType
        ? {
            id: m.materialType.id,
            material_type_name: m.materialType.materialTypeName,
            material_type_code: m.materialType.materialTypeCode,
          }
        : {},
      dimension_uom: uom(m.dimensionUom),
      weight_uom: uom(m.weightUom),
      primary_uom: uom(m.primaryUom),
      secondary_uom: uom(m.secondaryUom),
      material_name: m.materialName,
      material_code: m.materialCode,
      material_length: m.materialLength,
      material_width: m.materialWidth,
      material_height: m.materialHeight,
      material_weight: m.materialWeight,
      material_qty: m.materialQty,
      is_active: m.isActive,
      created_at: m.createdAt,
      created_by: m.createdBy,
      modified_by: m.modifiedBy,
      modified_at: m.updatedAt,
      photos: m.photos,
    };
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Material code already exists');
    }
    return e;
  }
}
