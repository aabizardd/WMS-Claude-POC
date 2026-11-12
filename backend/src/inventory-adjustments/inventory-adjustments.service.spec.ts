import { InventoryAdjustmentsService } from './inventory-adjustments.service';

/**
 * A document may span warehouses: the Oracle payload carries one line per
 * item AND location, and the header department wins over the creator's.
 */
describe('InventoryAdjustmentsService — Oracle payload', () => {
  function setup(body: Record<string, unknown> = { status: 'success', inventory_adjustment_id: 77, message: 'ok' }) {
    const postRaw = jest.fn().mockResolvedValue({ ok: true, status: 200, body });
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
      { qtyAdjustment: -1, qtyNonPassed: 0, material: { erpDocId: '500' }, warehouse: { oracleId: '1' } },
      { qtyAdjustment: -2, qtyNonPassed: 0, material: { erpDocId: '500' }, warehouse: { oracleId: '1' } },
      { qtyAdjustment: 5, qtyNonPassed: 0, material: { erpDocId: '500' }, warehouse: { oracleId: '15' } },
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

  it("returns Oracle's document_number, the Transaction ID, when the response has one", async () => {
    type Post = { postToOracle: (a: unknown) => Promise<{ documentNumber: string | null }> };
    const withNumber = setup({ status: 'success', inventory_adjustment_id: 77, document_number: 'IA-IEL-000123' });
    expect((await (withNumber.service as unknown as Post).postToOracle(doc)).documentNumber).toBe('IA-IEL-000123');
    const without = setup();
    expect((await (without.service as unknown as Post).postToOracle(doc)).documentNumber).toBeNull();
  });
});

describe('InventoryAdjustmentsService — Quality Adjustment (Oracle keeps Quality Issue on hand)', () => {
  type Svc = {
    postToOracle: (a: unknown) => Promise<unknown>;
    needsOracle: (a: unknown) => boolean;
  };
  const line = (qtyPassed: number, qtyNonPassed: number) => ({
    qtyAdjustment: 0,
    qtyPassed,
    qtyNonPassed,
    material: { erpDocId: '500' },
    warehouse: { oracleId: '1' },
  });

  it('posts only Qty Non-Passed, as a write-off', async () => {
    const postRaw = jest.fn().mockResolvedValue({ ok: true, status: 200, body: { status: 'success', inventory_adjustment_id: 1 } });
    const prisma = { inventoryAdjustmentIntegrationLog: { create: jest.fn().mockResolvedValue({}) } };
    const service = new InventoryAdjustmentsService(prisma as never, { postRaw } as never, {} as never) as unknown as Svc;
    await service.postToOracle({
      id: 'q1',
      adjustmentNumber: 'ADJ-20261112-001',
      warehouse: { oracleId: '1' },
      class: { oracleId: '9' },
      department: { oracleId: '40' },
      createdBy: null,
      memo: null,
      adjustmentType: 'QualityAdjustment',
      discrepancies: [],
      items: [line(3, 2)],
    });
    expect(postRaw.mock.calls[0][1].lines).toEqual([{ item: 500, location: 1, quantity: -2, department: 40 }]);
  });

  it('reaches Oracle only when some line has Qty Non-Passed', () => {
    const service = new InventoryAdjustmentsService({} as never, {} as never, {} as never) as unknown as Svc;
    expect(service.needsOracle({ adjustmentType: 'QualityAdjustment', items: [line(3, 0)] })).toBe(false);
    expect(service.needsOracle({ adjustmentType: 'QualityAdjustment', items: [line(3, 0), line(0, 1)] })).toBe(true);
    expect(service.needsOracle({ adjustmentType: 'CycleCount', items: [line(0, 0)] })).toBe(true);
  });
});

describe('InventoryAdjustmentsService — approval', () => {
  it('lets the creator approve their own document', async () => {
    const doc = { id: 'a1', status: 'WaitingApproval', createdById: 7, warehouseId: 'w1', items: [] };
    const tx = {
      inventoryAdjustment: { update: jest.fn().mockResolvedValue({}) },
      inventoryAdjustmentEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      inventoryAdjustment: { findUnique: jest.fn().mockResolvedValue(doc) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new InventoryAdjustmentsService(prisma as never, {} as never, {} as never);
    const advance = jest.fn().mockResolvedValue('advanced');
    Object.assign(service, { advanceAfterApproval: advance });

    const scope = { userId: 7, role: 'Admin WH', warehouseIds: null };
    await expect(service.approve('a1', { action: 'approve' } as never, scope as never)).resolves.toBe('advanced');
    expect(tx.inventoryAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Approved', approvedById: 7 }) }),
    );
  });
});

describe('InventoryAdjustmentsService — background Oracle send', () => {
  const approved = { id: 'a1', status: 'Approved', oracleId: '-', warehouseId: 'w1', items: [] };
  const scope = { userId: 7, role: 'admin', warehouseIds: null };

  function setup(claimed: number) {
    const tx = {
      inventoryAdjustment: { update: jest.fn().mockResolvedValue({}) },
      inventoryAdjustmentEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      inventoryAdjustment: {
        findUnique: jest.fn().mockResolvedValue(approved),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...approved, adjustmentNumber: 'ADJ-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new InventoryAdjustmentsService(prisma as never, {} as never, {} as never);
    Object.assign(service, { findOne: jest.fn().mockResolvedValue('detail') });
    return { service, prisma, tx };
  }

  it('queues the send and returns before Oracle answers', async () => {
    const { service, prisma } = setup(1);
    const later = jest.fn();
    Object.assign(service, { deliverLater: later });
    await expect(service.sendToOracle('a1', scope as never)).resolves.toBe('detail');
    expect(prisma.inventoryAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ oracleSendingAt: null }) }),
    );
    expect(later).toHaveBeenCalledWith('a1', 7);
  });

  it('refuses a second send while one is running', async () => {
    const { service } = setup(0);
    await expect(service.sendToOracle('a1', scope as never)).rejects.toThrow('already being sent');
  });

  it('stores the Oracle id and Transaction ID and clears the sending state', async () => {
    const { service, tx } = setup(1);
    Object.assign(service, {
      postToOracle: jest.fn().mockResolvedValue({ inventoryAdjustmentId: 9, documentNumber: 'IA-IEL-000300', message: 'ok' }),
    });
    await service.deliver('a1', 7);
    expect(tx.inventoryAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'WaitingOracleApproval',
          oracleId: '9',
          transactionId: 'IA-IEL-000300',
          oracleSendingAt: null,
          oracleSendLock: null,
        }),
      }),
    );
  });

  it('keeps a failed send resendable', async () => {
    const { service, tx } = setup(1);
    Object.assign(service, { postToOracle: jest.fn().mockRejectedValue(new Error('Oracle down')) });
    await service.deliver('a1', 7);
    expect(tx.inventoryAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { oracleError: 'Oracle down', oracleSendingAt: null, oracleSendLock: null } }),
    );
  });
});
