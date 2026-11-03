import { lineKey, readCreatedTo, wibTranDate } from './transfer-order-create.service';

describe('wibTranDate', () => {
  it('formats today in WIB as DD/MM/YYYY', () => {
    expect(wibTranDate(new Date('2026-10-26T03:00:00Z'))).toBe('26/10/2026');
  });

  it('rolls over to the next day after 17:00 UTC', () => {
    expect(wibTranDate(new Date('2026-12-31T17:30:00Z'))).toBe('01/01/2027');
  });
});

describe('readCreatedTo', () => {
  it('reads the id and number from data', () => {
    expect(readCreatedTo({ success: true, data: { id: 12345, tranid: 'TO-IEL-1' } })).toEqual({
      oracleId: '12345',
      tranId: 'TO-IEL-1',
    });
  });

  it('falls back to top-level fields', () => {
    expect(readCreatedTo({ success: true, transfer_order_id: 9, tranid: 'TO-2' })).toEqual({
      oracleId: '9',
      tranId: 'TO-2',
    });
  });

  it('returns nulls when the bridge sends neither', () => {
    expect(readCreatedTo({ success: true })).toEqual({ oracleId: null, tranId: null });
    expect(readCreatedTo(null)).toEqual({ oracleId: null, tranId: null });
  });
});

describe('lineKey', () => {
  it('ignores line order and number formatting', () => {
    expect(lineKey([[18273, 1], ['18234', '2']])).toBe(lineKey([['18234', 2], ['18273', '1']]));
  });

  it('tells different quantities apart', () => {
    expect(lineKey([[18273, 1]])).not.toBe(lineKey([[18273, 2]]));
  });
});
