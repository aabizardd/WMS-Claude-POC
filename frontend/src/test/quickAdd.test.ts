import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../pages/outbound/quickAdd';

describe('parseQuickAdd', () => {
  it('reads Excel (Tab), comma, semicolon and space separated rows, keeping repeated PNs apart', () => {
    const { rows, skippedHeader } = parseQuickAdd(
      [
        'PN\tQty\tDescription',
        '06.04209.0025\t10\tRak A',
        '06.04209.0025\t5\tRak B',
        '04.39535.9011\t20',
        '',
        '0220-609-9-Z61091, 12, note, with comma',
        'BY1000424655; 3',
        '1020900100 - REVERSE ALARM 7',
      ].join('\n'),
    );
    expect(skippedHeader).toBe(true);
    expect(rows.map((r) => [r.line, r.code, r.qty, r.description, r.error])).toEqual([
      [2, '06.04209.0025', 10, 'Rak A', null],
      [3, '06.04209.0025', 5, 'Rak B', null],
      [4, '04.39535.9011', 20, '', null],
      [6, '0220-609-9-Z61091', 12, 'note, with comma', null],
      [7, 'BY1000424655', 3, '', null],
      [8, '1020900100 - REVERSE ALARM', 7, '', null],
    ]);
  });

  it('flags lines it cannot use', () => {
    const { rows } = parseQuickAdd(['ABC\t', 'ABC\tx', 'ABC\t0', '\t5', 'ABC\t2,5'].join('\n'));
    expect(rows.map((r) => r.error)).toEqual(['Missing qty', 'Invalid qty "x"', 'Qty must be above 0', 'Missing PN', null]);
    expect(rows[4].qty).toBe(2.5);
  });
});
