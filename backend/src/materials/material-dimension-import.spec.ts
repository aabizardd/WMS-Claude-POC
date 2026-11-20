import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { MaterialDimensionImportService } from './material-dimension-import.service';
import { parseAmount, readDimensionFile, writeDimensionTemplate } from './material-dimension-import';

const material = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  materialCode: 'BOLT-01',
  erpDocId: '100',
  materialName: 'BOLT',
  materialLength: 0,
  materialWidth: 0,
  materialHeight: 0,
  materialWeight: 2,
  dimensionUomId: null,
  weightUomId: 'u-kg',
  ...over,
});
const uoms = [
  { id: 'u-cm', uomCode: 'cm', uomName: 'Centimeter' },
  { id: 'u-kg', uomCode: 'Kg', uomName: 'Kilogram' },
];

async function workbook(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dimensions');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEADER = ['Material Code', 'ERP Doc ID', 'Material Name', 'Length', 'Width', 'Height', 'UoD', 'Weight', 'Weight UoM'];

function service(materials = [material(), material({ id: 'm2', materialCode: 'NUT-02', erpDocId: '200' })]) {
  const prisma = {
    material: {
      findMany: jest.fn().mockResolvedValue(materials),
      count: jest.fn(),
      update: jest.fn((args: unknown) => args),
    },
    uom: { findMany: jest.fn().mockResolvedValue(uoms), count: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { svc: new MaterialDimensionImportService(prisma as never), prisma };
}

describe('Material dimension import', () => {
  it('reads numbers with a decimal comma or point, and leaves empty cells out', () => {
    expect(parseAmount('12,5')).toEqual({ value: 12.5 });
    expect(parseAmount('3.25')).toEqual({ value: 3.25 });
    expect(parseAmount(7)).toEqual({ value: 7 });
    expect(parseAmount('')).toEqual({});
    expect(parseAmount('abc').error).toBeDefined();
    expect(parseAmount(-1).error).toBeDefined();
  });

  it('previews only the changed fields; empty cells keep the stored value', async () => {
    const { svc } = service();
    const buf = await workbook([
      HEADER,
      ['bolt-01', '100', 'BOLT', 10, '20,5', null, 'CM', null, null],
      ['NUT-02', null, null, null, null, null, null, null, null],
    ]);
    const res = await svc.preview(buf);
    expect(res.summary).toEqual({ rows: 2, update: 1, unchanged: 1, error: 0 });
    const [bolt] = res.rows;
    expect(bolt.material_code).toBe('BOLT-01');
    expect(bolt.changes.map((c) => [c.label, c.from, c.to])).toEqual([
      ['Length', 0, 10],
      ['Width', 0, 20.5],
      ['UoD', null, 'cm'],
    ]);
    // Weight (2) and Weight UoM were left empty: not part of the payload.
    expect(bolt.payload).toEqual({ id: 'm1', material_length: 10, material_width: 20.5, dimension_uom_id: 'u-cm' });
  });

  it('flags unknown materials, bad numbers, unknown UoMs, mismatched ERP ids and duplicates', async () => {
    const { svc } = service();
    const buf = await workbook([
      HEADER,
      ['NOPE', null, null, 1, null, null, null, null, null],
      ['BOLT-01', null, null, 'x', null, null, 'inch', null, null],
      ['NUT-02', '999', null, 1, null, null, null, null, null],
      [null, '200', null, 3, null, null, null, null, null],
      [null, '200', null, 4, null, null, null, null, null],
    ]);
    const res = await svc.preview(buf);
    const errs = res.rows.map((r) => r.errors.join(' | '));
    expect(errs[0]).toContain('"NOPE" not found');
    expect(errs[1]).toContain('Length "x" is not a number');
    expect(errs[1]).toContain('UoD "inch" is not a UoM');
    expect(errs[2]).toContain('does not belong to NUT-02');
    expect(res.rows[3].status).toBe('update');
    expect(errs[4]).toContain('Duplicate of line 5');
    expect(res.rows.filter((r) => r.status === 'error').every((r) => r.payload === null)).toBe(true);
  });

  it('rejects a file without the Material Code / ERP Doc ID header', async () => {
    const { svc } = service();
    await expect(svc.preview(await workbook([['foo', 'bar'], ['1', '2']]))).rejects.toThrow(/Material Code/);
  });

  it('applies the checked rows in one transaction, stamping who changed them', async () => {
    const { svc, prisma } = service();
    prisma.material.count.mockResolvedValue(1);
    prisma.uom.count.mockResolvedValue(1);
    const res = await svc.apply({ rows: [{ id: 'm1', material_length: 10, dimension_uom_id: 'u-cm' }] }, 'admin');
    expect(res).toEqual({ updated: 1 });
    expect(prisma.material.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ materialLength: 10, dimensionUomId: 'u-cm', materialWidth: undefined, modifiedBy: 'admin' }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('writes a template that reads back with the current values (empty dimensions left blank)', async () => {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    await writeDimensionTemplate(
      out,
      [
        {
          materialCode: '00123',
          erpDocId: '100',
          materialName: 'BOLT',
          materialLength: 0,
          materialWidth: 5,
          materialHeight: 0,
          materialWeight: 1.5,
          dimensionUom: { uomCode: 'cm' },
          weightUom: null,
        },
      ],
      uoms,
    );
    out.end();
    const file = await readDimensionFile(Buffer.concat(chunks));
    expect(file.error).toBeUndefined();
    expect(file.rows).toEqual([
      { line: 2, code: '00123', erp: '100', values: { width: 5, dimension_uom: 'cm', weight: 1.5 } },
    ]);
  });
});
