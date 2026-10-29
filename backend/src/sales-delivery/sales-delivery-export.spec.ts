import { salesDeliveryExportFileName } from './sales-delivery-export';
import { wibDateTime } from '../common/xlsx-export';

describe('Inventory Sales export', () => {
  it('names the file after the period it covers, in WIB, as WMS dev does', () => {
    expect(
      salesDeliveryExportFileName(new Date('2026-09-29T17:00:00Z'), new Date('2026-10-29T16:59:59Z')),
    ).toBe('SDKawasan-20260930-000000-20261029-235959.xlsx');
  });

  it('writes dates as WIB "YYYY-MM-DD HH:mm:ss"', () => {
    expect(wibDateTime(new Date('2026-10-27T07:33:11Z'))).toBe('2026-10-27 14:33:11');
  });
});
