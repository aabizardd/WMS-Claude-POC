import { TransferOrdersService } from './transfer-orders.service';
import { transferOrderExportFileName } from './transfer-order-export';

describe('Transfer Order export (TO Out / TO In)', () => {
  const shipped = (qty: number, sd: string, at: string) => ({
    qty,
    bin: { binLabel: 'STG-01' },
    pickingItem: { bin: { binLabel: 'A-01' } },
    packing: { packingCode: 'PACK-1' },
    delivery: { sdoId: sd, deliveryCode: 'DEL-1', updatedAt: new Date(at) },
  });
  const order = {
    id: 'to1',
    tranId: 'TO-IEL-000001',
    statusName: 'Pending Receipt',
    oracleId: '254002',
    fromLocationName: 'Jakarta - IEL',
    toLocationName: 'Kendari',
    toWarehouseId: null,
    createdAt: new Date('2026-10-28T01:14:00Z'),
    warehouse: { name: 'Jakarta - IEL' },
    items: [
      // Shipped twice through WMS, 7 of 10 received: spread over the SDs in order.
      { id: 'l1', lineNumber: 1, itemName: 'BOLT-1', description: 'BOLT', quantity: 10, fulfilled: 10, received: 7, materialId: null,
        deliveryItems: [shipped(4, 'SD-A', '2026-10-28T02:00:00Z'), shipped(6, 'SD-B', '2026-10-28T03:00:00Z')] },
      // Fulfilled in Oracle directly: its own figures, no SD.
      { id: 'l2', lineNumber: 2, itemName: 'NUT-2', description: 'NUT', quantity: 5, fulfilled: 5, received: 5, materialId: null, deliveryItems: [] },
      // Nothing shipped.
      { id: 'l3', lineNumber: 3, itemName: 'NUT-3', description: 'NUT', quantity: 2, fulfilled: 0, received: 0, materialId: null, deliveryItems: [] },
    ],
  };
  function setup() {
    const prisma = {
      transferOrder: { findMany: jest.fn().mockResolvedValue([order]) },
      goodsReceiveItem: {
        findMany: jest.fn().mockResolvedValue([
          { transferOrderItemId: 'l1', goodsReceive: { updatedAt: new Date('2026-10-29T04:00:00Z') } },
        ]),
      },
      material: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new TransferOrdersService(prisma as never);
  }
  const collect = async (s: TransferOrdersService, filters: { field: string; values: string[] }[] = [], sdOnly = false) => {
    const out = [];
    for await (const rows of s.exportRows({ filters, sd_only: sdOnly ? 'true' : undefined } as never, { role: 'admin', warehouseIds: null })) out.push(...rows);
    return out;
  };

  it('writes a row per shipped delivery line and spreads the received qty in shipping order', async () => {
    const rows = await collect(setup());
    expect(rows.map((r) => [r.erp_line_id, r.sd_number, r.qty_shipped, r.qty_received])).toEqual([
      [1, 'SD-A', 4, 4],
      [1, 'SD-B', 6, 3],
      [2, null, 5, 5],
      [3, null, null, null],
    ]);
    expect(rows[0]).toMatchObject({ from_bin: 'A-01', staging_bin: 'STG-01', packing_id: 'PACK-1' });
    expect(rows[3].date_received).toBeNull();
  });

  it('keeps only the lines a Part Number filter matches', async () => {
    const rows = await collect(setup(), [{ field: 'material_code', values: ['nut'] }]);
    expect(rows.map((r) => r.erp_line_id)).toEqual([2, 3]);
  });

  it('Export SD keeps only the shipped delivery lines', async () => {
    const rows = await collect(setup(), [], true);
    expect(rows.map((r) => [r.erp_line_id, r.sd_number])).toEqual([
      [1, 'SD-A'],
      [1, 'SD-B'],
    ]);
  });

  it('Export SD only asks for TOs that have an SD', async () => {
    const prisma = { transferOrder: { findMany: jest.fn().mockResolvedValue([]) } };
    const s = new TransferOrdersService(prisma as never);
    for await (const _ of s.exportRows({ sd_only: 'true' } as never, { role: 'admin', warehouseIds: null })) void _;
    expect(JSON.stringify(prisma.transferOrder.findMany.mock.calls[0][0].where)).toContain('"status":"Closed"');
  });

  it('Export SD summary counts filtered and all TOs with an SD', async () => {
    const prisma = {
      material: { findMany: jest.fn().mockResolvedValue([{ id: 'm1' }]) },
      transferOrder: { count: jest.fn().mockResolvedValue(2) },
      deliveryItem: { count: jest.fn().mockResolvedValue(5) },
      $transaction: (ops: Promise<number>[]) => Promise.all(ops),
    };
    const s = new TransferOrdersService(prisma as never);
    const out = await s.exportSdSummary(
      { status: 'Pending Receipt', filters: [{ field: 'material_code', values: ['bolt'] }] } as never,
      { role: 'admin', warehouseIds: null },
    );
    expect(out).toEqual({ filtered: { documents: 2, rows: 5 }, all: { documents: 2, rows: 5 } });
    // The two counts run side by side: told apart by their where.
    const wheres = prisma.deliveryItem.count.mock.calls.map((c) => JSON.stringify(c[0].where));
    const filteredRows = wheres.find((w) => w.includes('Pending Receipt'))!;
    const allRows = wheres.find((w) => w !== filteredRows)!;
    expect(wheres).toHaveLength(2);
    expect(filteredRows).toContain('"m1"');
    expect(allRows).not.toContain('Pending Receipt');
    expect(allRows).toContain('"status":"Closed"');
  });

  it('names the file the way WMS dev does, in WIB', () => {
    expect(transferOrderExportFileName(new Date('2026-10-29T04:50:41Z'), true)).toBe('sales_delivery_export_20261029_115041.xlsx');
    expect(transferOrderExportFileName(new Date('2026-10-29T04:50:41Z'))).toBe('transfer_order_export_20261029_115041.xlsx');
  });
});
