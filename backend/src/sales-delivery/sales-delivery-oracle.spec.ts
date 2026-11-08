import {
  SalesDeliveryService,
  buildTransferPayload,
  readCreatedTransfer,
  transferTranDate,
} from './sales-delivery.service';

/** Inventory Sales → Oracle inventory/transfer, posted in the background. */
describe('SalesDeliveryService — Oracle inventory transfer', () => {
  const doc = {
    id: 'sd1',
    deliveryNumber: 'SD-20261108-001',
    // 23:30 UTC is already the 9th in WIB.
    createdAt: new Date('2026-11-08T23:30:00Z'),
    memo: 'Catatan | SD-20261108-001',
    fromWarehouse: { oracleId: '19', name: 'Jakarta - IEL' },
    toWarehouse: { oracleId: '20', name: 'VHS Billing' },
    department: { oracleId: '105' },
    class: { oracleId: '1' },
    items: [
      { qtyTransfer: 1, materialCode: 'A', material: { erpDocId: '26589' } },
      { qtyTransfer: 2, materialCode: 'A', material: { erpDocId: '26589' } },
      { qtyTransfer: 4, materialCode: 'B', material: { erpDocId: '500' } },
    ],
  };

  it('builds the request: subsidiary 6, Oracle ids, WIB submit date, one line per item', () => {
    expect(buildTransferPayload(doc)).toEqual({
      subsidiary: 6,
      from_location: 19,
      to_location: 20,
      trandate: '09-11-2026',
      department: 105,
      class: 1,
      memo: 'Catatan | SD-20261108-001',
      lines: [
        { item: 26589, quantity: 3 },
        { item: 500, quantity: 4 },
      ],
    });
    expect(transferTranDate(new Date('2026-09-24T03:00:00Z'))).toBe('24-09-2026');
  });

  it('refuses a document with a warehouse that has no Oracle id', () => {
    expect(() => buildTransferPayload({ ...doc, toWarehouse: { oracleId: null, name: 'X' } })).toThrow(
      'To Location X has no Oracle id',
    );
  });

  it('reads the id and document_number wherever the bridge puts them', () => {
    expect(readCreatedTransfer({ status: 'success', inventory_transfer_id: 89309, document_number: 'TRF-1' })).toEqual({
      id: '89309',
      documentNumber: 'TRF-1',
    });
    expect(readCreatedTransfer({ success: true, data: { id: 7, tranid: 'TRF-2' } })).toEqual({ id: '7', documentNumber: 'TRF-2' });
    expect(readCreatedTransfer(null)).toEqual({ id: null, documentNumber: null });
  });

  function setup(res: { ok: boolean; status: number; body: unknown } | Error) {
    const prisma = {
      salesDelivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(doc),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const postRaw = res instanceof Error ? jest.fn().mockRejectedValue(res) : jest.fn().mockResolvedValue(res);
    const service = new SalesDeliveryService(prisma as never, { postRaw } as never);
    return { service, prisma, postRaw };
  }

  it('on success stores the Oracle id as NetSuite ID and document_number as Transaction ID', async () => {
    const { service, prisma, postRaw } = setup({
      ok: true,
      status: 200,
      body: { status: 'success', inventory_transfer_id: 89309, document_number: 'TRF-IEL-0001' },
    });
    await service.send('sd1');
    expect(postRaw).toHaveBeenCalledWith('/inventory/transfer', expect.objectContaining({ subsidiary: 6 }), {
      idempotent: false,
    });
    expect(prisma.salesDelivery.update).toHaveBeenCalledWith({
      where: { id: 'sd1' },
      data: { status: 'Success', netsuiteId: '89309', transactionId: 'TRF-IEL-0001', oracleError: null, oracleSendLock: null },
    });
  });

  it('marks the document Failed with the reason when Oracle says no or cannot be reached', async () => {
    const rejected = setup({ ok: false, status: 400, body: { status: 'error', message: 'Item not available' } });
    await rejected.service.send('sd1');
    expect(rejected.prisma.salesDelivery.update).toHaveBeenCalledWith({
      where: { id: 'sd1' },
      data: { status: 'Failed', oracleError: 'Item not available', oracleSendLock: null },
    });

    const down = setup(new Error('ECONNRESET'));
    await down.service.send('sd1');
    expect(down.prisma.salesDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Failed', oracleError: 'Failed to reach Oracle: ECONNRESET' }) }),
    );
  });

  it('does nothing when another sender holds the document', async () => {
    const { service, prisma, postRaw } = setup({ ok: true, status: 200, body: {} });
    prisma.salesDelivery.updateMany.mockResolvedValue({ count: 0 });
    await service.send('sd1');
    expect(postRaw).not.toHaveBeenCalled();
  });
});
