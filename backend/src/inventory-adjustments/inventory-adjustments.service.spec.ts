import { InventoryAdjustmentsService } from './inventory-adjustments.service';

/**
 * A document may span warehouses: the Oracle payload carries one line per
 * item AND location, and the header department wins over the creator's.
 */
describe('InventoryAdjustmentsService — Oracle payload', () => {
  function setup() {
    const postRaw = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { status: 'success', inventory_adjustment_id: 77, message: 'ok' },
    });
    const prisma = { inventoryAdjustmentIntegrationLog: { create: jest.fn().mockResolvedValue({}) } };
    const service = new InventoryAdjustmentsService(prisma as never, { postRaw } as never, {} as never);
    return { service, postRaw };
  }

  const doc = {
    id: 'a1',
    adjustmentNumber: 'ADJ-20261029-001',
    warehouse: { oracleId: '1' },
    class: { oracleId: '9' },
    department: { oracleId: '40' },
    createdBy: { department: { oracleId: '12' } },
    memo: null,
    adjustmentType: 'CycleCount' as const,
    discrepancies: [],
    items: [
      { qtyAdjustment: -1, qtyPassed: 0, material: { erpDocId: '500' }, warehouse: { oracleId: '1' } },
      { qtyAdjustment: -2, qtyPassed: 0, material: { erpDocId: '500' }, warehouse: { oracleId: '1' } },
      { qtyAdjustment: 5, qtyPassed: 0, material: { erpDocId: '500' }, warehouse: { oracleId: '15' } },
    ],
  };

  it('groups lines per item and location, with the header department', async () => {
    const { service, postRaw } = setup();
    await (service as unknown as { postToOracle: (a: typeof doc) => Promise<unknown> }).postToOracle(doc);
    const payload = postRaw.mock.calls[0][1];
    expect(payload.department).toBe(40);
    expect(payload.adjlocation).toBe(1);
    expect(payload.lines).toEqual([
      { item: 500, location: 1, quantity: -3, department: 40 },
      { item: 500, location: 15, quantity: 5, department: 40 },
    ]);
  });

  it("falls back to the creator's department on older documents", async () => {
    const { service, postRaw } = setup();
    await (service as unknown as { postToOracle: (a: unknown) => Promise<unknown> }).postToOracle({ ...doc, department: null });
    expect(postRaw.mock.calls[0][1].department).toBe(12);
  });
});
