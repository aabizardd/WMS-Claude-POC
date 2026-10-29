import { MrnSyncService } from './mrn-sync.service';

/** The PIB's Nomor Aju comes from the shipment's custrecord_msi_aju_no. */
describe('MrnSyncService — Nomor Aju', () => {
  function setup() {
    const upsert = jest.fn().mockResolvedValue({ id: 'm1' });
    const prisma = {
      warehouse: { findUnique: jest.fn().mockResolvedValue(null) },
      mrn: { upsert },
      mrnItem: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      goodsReceive: { findFirst: jest.fn().mockResolvedValue({ id: 'gr' }) },
    };
    const service = new MrnSyncService(prisma as never, {} as never, {} as never);
    const run = (pib: Record<string, unknown>) =>
      (service as unknown as { upsert: (p: unknown) => Promise<boolean> }).upsert({ id: 67, items: [], ...pib });
    return { run, upsert };
  }

  it.each([
    [' 000123-ABC ', '000123-ABC'],
    [123456, '123456'],
    [null, null],
    ['  ', null],
  ])('stores %p as %p', async (raw, stored) => {
    const { run, upsert } = setup();
    await run({ custrecord_msi_aju_no: raw }).catch(() => undefined);
    expect(upsert.mock.calls[0][0].update.ajuNumber).toBe(stored);
  });
});
