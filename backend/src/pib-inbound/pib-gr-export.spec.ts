import { oracleDate, pibGrExportFileName } from './pib-gr-export';

describe('Goods Receive - PIB export', () => {
  it('writes Oracle d/m/yyyy shipment dates as WMS dev does', () => {
    expect(oracleDate('25/5/2026')).toBe('2026-05-25 00:00');
    expect(oracleDate('7/10/2026')).toBe('2026-10-07 00:00');
    expect(oracleDate(null)).toBeNull();
    expect(oracleDate('2026-05-25')).toBe('2026-05-25');
  });

  it('names the file the way WMS dev does, in WIB', () => {
    expect(pibGrExportFileName(new Date('2026-10-29T09:27:30Z'))).toBe('pib_goods_receive_export_20261029_162730.xlsx');
  });
});
