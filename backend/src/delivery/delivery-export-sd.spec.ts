import { DeliveryService } from './delivery.service';

describe('Delivery Plan Export SD', () => {
  function setup() {
    const prisma = {
      delivery: { count: jest.fn().mockResolvedValue(3) },
      deliveryItem: { count: jest.fn().mockResolvedValue(7) },
      $transaction: (ops: Promise<number>[]) => Promise.all(ops),
    };
    const transferOrders = { exportSdRows: jest.fn() };
    const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, transferOrders as never);
    return { service, prisma };
  }
  const admin = { role: 'admin', warehouseIds: null };

  it('counts SDs and SD lines for the filters and for all', async () => {
    const { service, prisma } = setup();
    const out = await service.exportSdSummary(
      { filters: [{ field: 'sdo_id', values: ['SD-9'] }, { field: 'material_code', values: ['BOLT'] }] },
      admin,
    );
    expect(out).toEqual({ filtered: { documents: 3, rows: 7 }, all: { documents: 3, rows: 7 } });
    const wheres = prisma.deliveryItem.count.mock.calls.map((c) => JSON.stringify(c[0].where));
    const filtered = wheres.find((w) => w.includes('SD-9'))!;
    const all = wheres.find((w) => w !== filtered)!;
    // SD lines only: shipped TO deliveries, tied to a TO line.
    for (const w of [filtered, all]) {
      expect(w).toContain('"sourceType":"TRANSFER_ORDER","status":"Closed"');
      expect(w).toContain('"transferOrderItemId":{"not":null}');
    }
    // A Part Number filter keeps only the matching lines.
    expect(filtered).toContain('"materialCode":{"contains":"BOLT"');
    expect(all).not.toContain('BOLT');
  });
});
