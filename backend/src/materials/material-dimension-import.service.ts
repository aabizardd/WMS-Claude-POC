import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Writable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplyDimensionImportDto } from './dto/apply-dimension-import.dto';
import {
  FIELD_LABEL,
  type NumField,
  type UomField,
  parseAmount,
  readDimensionFile,
  writeDimensionTemplate,
} from './material-dimension-import';

const NUM_COLUMN: Record<NumField, 'materialLength' | 'materialWidth' | 'materialHeight' | 'materialWeight'> = {
  length: 'materialLength',
  width: 'materialWidth',
  height: 'materialHeight',
  weight: 'materialWeight',
};
const UOM_COLUMN: Record<UomField, 'dimensionUomId' | 'weightUomId'> = {
  dimension_uom: 'dimensionUomId',
  weight_uom: 'weightUomId',
};
/** The apply payload's key per field. */
const PAYLOAD_KEY = {
  length: 'material_length',
  width: 'material_width',
  height: 'material_height',
  weight: 'material_weight',
  dimension_uom: 'dimension_uom_id',
  weight_uom: 'weight_uom_id',
} as const;

export interface DimensionChange {
  field: NumField | UomField;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

export interface DimensionPreviewRow {
  line: number;
  material_code: string;
  erp_doc_id: string | null;
  material_name: string | null;
  material_id: string | null;
  /** update: has changes; unchanged: same as stored; error: cannot be applied. */
  status: 'update' | 'unchanged' | 'error';
  errors: string[];
  changes: DimensionChange[];
  /** What Apply sends for this row (only the changed fields). */
  payload: Record<string, string | number> | null;
}

const materialSelect = {
  id: true,
  materialCode: true,
  erpDocId: true,
  materialName: true,
  materialLength: true,
  materialWidth: true,
  materialHeight: true,
  materialWeight: true,
  dimensionUomId: true,
  weightUomId: true,
} satisfies Prisma.MaterialSelect;

@Injectable()
export class MaterialDimensionImportService {
  constructor(private prisma: PrismaService) {}

  /** Same search as the Materials list (code or name), every match. */
  private searchWhere(search?: string): Prisma.MaterialWhereInput {
    const s = search?.trim();
    return s
      ? {
          OR: [
            { materialName: { contains: s, mode: 'insensitive' } },
            { materialCode: { contains: s, mode: 'insensitive' } },
          ],
        }
      : {};
  }

  async template(search: string | undefined, out: Writable) {
    const [materials, uoms] = await Promise.all([
      this.prisma.material.findMany({
        where: this.searchWhere(search),
        orderBy: { materialCode: 'asc' },
        select: {
          materialCode: true,
          erpDocId: true,
          materialName: true,
          materialLength: true,
          materialWidth: true,
          materialHeight: true,
          materialWeight: true,
          dimensionUom: { select: { uomCode: true } },
          weightUom: { select: { uomCode: true } },
        },
      }),
      this.prisma.uom.findMany({ orderBy: { uomCode: 'asc' }, select: { uomCode: true, uomName: true } }),
    ]);
    await writeDimensionTemplate(out, materials, uoms);
  }

  /** Check an uploaded file row by row against the stored materials; nothing is written. */
  async preview(buffer: Buffer) {
    const file = await readDimensionFile(buffer);
    if (file.error) throw new BadRequestException(file.error);

    const [materials, uoms] = await Promise.all([
      this.prisma.material.findMany({ select: materialSelect }),
      this.prisma.uom.findMany({ select: { id: true, uomCode: true, uomName: true } }),
    ]);
    const byCode = new Map(materials.map((m) => [m.materialCode.trim().toLowerCase(), m]));
    const byErp = new Map(materials.filter((m) => m.erpDocId).map((m) => [m.erpDocId!.trim(), m]));
    const uomBy = new Map<string, (typeof uoms)[number]>();
    for (const u of uoms) {
      uomBy.set(u.uomName.trim().toLowerCase(), u);
      uomBy.set(u.uomCode.trim().toLowerCase(), u);
    }
    const uomCode = new Map(uoms.map((u) => [u.id, u.uomCode]));
    const uomCodes = uoms.map((u) => u.uomCode).join(', ');

    const seen = new Map<string, number>();
    const rows: DimensionPreviewRow[] = file.rows.map((r) => {
      const errors: string[] = [];
      const byC = r.code ? byCode.get(r.code.trim().toLowerCase()) : undefined;
      const byE = r.erp ? byErp.get(r.erp.trim()) : undefined;
      let m = byC ?? (r.code ? undefined : byE);
      if (r.code && !byC) errors.push(`Material Code "${r.code}" not found`);
      else if (!r.code && r.erp && !byE) errors.push(`ERP Doc ID "${r.erp}" not found`);
      else if (!r.code && !r.erp) errors.push('Material Code is empty');
      if (byC && r.erp && byC.erpDocId && byC.erpDocId.trim() !== r.erp.trim()) {
        errors.push(`ERP Doc ID "${r.erp}" does not belong to ${byC.materialCode} (${byC.erpDocId})`);
        m = undefined;
      }
      if (m) {
        const first = seen.get(m.id);
        if (first != null) errors.push(`Duplicate of line ${first}: each material may appear once`);
        else seen.set(m.id, r.line);
      }

      const changes: DimensionChange[] = [];
      const payload: Record<string, string | number> = {};
      for (const f of ['length', 'width', 'height', 'weight'] as NumField[]) {
        const p = parseAmount(r.values[f]);
        if (p.error) errors.push(`${FIELD_LABEL[f]} ${p.error}`);
        else if (p.value !== undefined && m && m[NUM_COLUMN[f]] !== p.value) {
          changes.push({ field: f, label: FIELD_LABEL[f], from: m[NUM_COLUMN[f]], to: p.value });
          payload[PAYLOAD_KEY[f]] = p.value;
        }
      }
      for (const f of ['dimension_uom', 'weight_uom'] as UomField[]) {
        const raw = r.values[f];
        if (raw === undefined || raw === '') continue;
        const u = uomBy.get(String(raw).trim().toLowerCase());
        if (!u) errors.push(`${FIELD_LABEL[f]} "${raw}" is not a UoM (use ${uomCodes})`);
        else if (m && m[UOM_COLUMN[f]] !== u.id) {
          const cur = m[UOM_COLUMN[f]];
          changes.push({ field: f, label: FIELD_LABEL[f], from: cur ? (uomCode.get(cur) ?? null) : null, to: u.uomCode });
          payload[PAYLOAD_KEY[f]] = u.id;
        }
      }

      const status: DimensionPreviewRow['status'] = errors.length ? 'error' : changes.length ? 'update' : 'unchanged';
      return {
        line: r.line,
        material_code: m?.materialCode ?? r.code,
        erp_doc_id: m?.erpDocId ?? (r.erp || null),
        material_name: m?.materialName ?? null,
        material_id: m?.id ?? null,
        status,
        errors,
        changes: status === 'error' ? [] : changes,
        payload: status === 'update' ? { id: m!.id, ...payload } : null,
      };
    });

    return {
      sheet: file.sheet,
      columns: file.columns.map((f) => FIELD_LABEL[f]),
      truncated: file.truncated,
      summary: {
        rows: rows.length,
        update: rows.filter((r) => r.status === 'update').length,
        unchanged: rows.filter((r) => r.status === 'unchanged').length,
        error: rows.filter((r) => r.status === 'error').length,
      },
      rows,
    };
  }

  /** Write the preview's checked changes. Ids and UoMs are re-checked; all or nothing. */
  async apply(dto: ApplyDimensionImportDto, actor?: string) {
    const ids = dto.rows.map((r) => r.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A material appears more than once');
    const uomIds = [
      ...new Set(dto.rows.flatMap((r) => [r.dimension_uom_id, r.weight_uom_id]).filter((v): v is string => !!v)),
    ];
    const [found, foundUoms] = await Promise.all([
      this.prisma.material.count({ where: { id: { in: ids } } }),
      uomIds.length ? this.prisma.uom.count({ where: { id: { in: uomIds } } }) : 0,
    ]);
    if (found !== ids.length) throw new BadRequestException('Some materials no longer exist — check the file again');
    if (foundUoms !== uomIds.length) throw new BadRequestException('Some UoMs no longer exist — check the file again');

    const updates = dto.rows.map((r) =>
      this.prisma.material.update({
        where: { id: r.id },
        data: {
          materialLength: r.material_length,
          materialWidth: r.material_width,
          materialHeight: r.material_height,
          materialWeight: r.material_weight,
          dimensionUomId: r.dimension_uom_id,
          weightUomId: r.weight_uom_id,
          modifiedBy: actor,
        },
        select: { id: true },
      }),
    );
    await this.prisma.$transaction(updates);
    return { updated: updates.length };
  }
}
