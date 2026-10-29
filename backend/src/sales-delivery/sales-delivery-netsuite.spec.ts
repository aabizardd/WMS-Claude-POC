import { SalesDeliveryService } from './sales-delivery.service';

/** The dummy NetSuite id a new Sales Delivery / Return gets on create. */
describe('SalesDeliveryService — dummy NetSuite id', () => {
  const service = new SalesDeliveryService({} as never);
  const next = (max: bigint | null) =>
    (service as unknown as { nextNetsuiteId: (tx: unknown) => Promise<string> }).nextNetsuiteId({
      $queryRaw: jest.fn().mockResolvedValue([{ max }]),
    });

  it('rises above the highest id so far, in a step of 1-120', async () => {
    for (let i = 0; i < 50; i++) {
      const id = Number(await next(BigInt(110800)));
      expect(id).toBeGreaterThan(110800);
      expect(id).toBeLessThanOrEqual(110920);
    }
  });

  it('starts from 110000 when no document has one yet', async () => {
    const id = Number(await next(null));
    expect(id).toBeGreaterThan(110000);
    expect(id).toBeLessThanOrEqual(110120);
  });
});
