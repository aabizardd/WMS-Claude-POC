import ExcelJS from 'exceljs';
import { parseToImport } from './to-import';

/** A workbook laid out like the sites' transfer lists: a title, a bilingual header, then rows. */
async function workbook(withNote: boolean) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TRUCK A');
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'DAFTAR AKSESORIS TRANSFER IMIP TO KENDARI';
  ws.getRow(2).values = [
    '序号\nNomor seri',
    '物料编码\nKode Material',
    '物料名称\nNama Item',
    '调拨数量\nJumlah Transfer',
    ...(withNote ? ['备注\nKeterangan'] : []),
  ];
  ws.addRow([1, 'DZ91189554790', 'FUEL TANK ASSEMBLY', 30, withNote ? 'Rak A' : undefined]);
  ws.addRow([52, 'BY612600114993', 'AIR FILTER', 32]);
  ws.addRow([53, 'BY612600114993', 'AIR FILTER', 12]);
  ws.addRow([]);
  ws.addRow([54, 102081540, 'OIL', 'abc']);
  wb.addWorksheet('Kosong');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseToImport', () => {
  it('finds the bilingual header under a title and reads every row, repeated codes kept apart', async () => {
    const r = await parseToImport(await workbook(true));
    expect(r.sheet).toBe('TRUCK A');
    expect(r.header_row).toBe(2);
    expect(Object.keys(r.columns).sort()).toEqual(['code', 'description', 'name', 'qty']);
    expect(r.sheets.map((s) => s.name)).toEqual(['TRUCK A', 'Kosong']);
    expect(r.rows.map((x) => [x.line, x.code, x.qty, x.qty_text, x.description])).toEqual([
      [3, 'DZ91189554790', 30, '30', 'Rak A'],
      [4, 'BY612600114993', 32, '32', ''],
      [5, 'BY612600114993', 12, '12', ''],
      [7, '102081540', null, 'abc', ''],
    ]);
  });

  it('works without a Keterangan column and reports a sheet without a header', async () => {
    const buf = await workbook(false);
    expect((await parseToImport(buf)).rows[0].description).toBe('');
    const empty = await parseToImport(buf, 'Kosong');
    expect(empty.rows).toEqual([]);
    expect(empty.error).toMatch(/No header/);
  });
});
