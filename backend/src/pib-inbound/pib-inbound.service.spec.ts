import { PibInboundService } from './pib-inbound.service';

/** Inbound from PIB: GR lines are MRN items; filters on the shipment go through the MRN. */
describe('PibInboundService', () => {
  const svc = (prisma: unknown) => new PibInboundService(prisma as never);
  type Priv = {
    grFilter: (f: string, v: string) => Promise<unknown>;
    lineQty: (it: { qtyExpected: number; qtyActual: number; qtyRemaining: number }, received: boolean) => unknown;
  };

  it('filters on Nomor Aju through the MRN', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    const where = await (svc({ mrn: { findMany } }) as unknown as Priv).grFilter('aju_number', '000123');
    expect(findMany).toHaveBeenCalledWith({
      where: { ajuNumber: { contains: '000123', mode: 'insensitive' } },
      select: { id: true },
    });
    expect(where).toEqual({ sourceDocId: { in: ['m1', 'm2'] } });
  });

  it('shows putaway / remain qty only once the GR is received', () => {
    const s = svc({}) as unknown as Priv;
    const line = { qtyExpected: 120, qtyActual: 120, qtyRemaining: 90 };
    expect(s.lineQty(line, false)).toEqual({ planned_qty: 120, actual_qty: 120, putaway_qty: 0, remain_qty: 0 });
    expect(s.lineQty(line, true)).toEqual({ planned_qty: 120, actual_qty: 120, putaway_qty: 30, remain_qty: 90 });
  });
});
