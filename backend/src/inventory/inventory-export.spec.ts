import { InventoryService } from './inventory.service';
import { inventoryExportFileName } from './inventory-export';

describe('Inventory List export', () => {
  it('names the file the way WMS dev does, in WIB', () => {
    expect(inventoryExportFileName(new Date('2026-10-29T06:16:33Z'))).toBe(
      'inventory_details-2026-10-29_131633-WIB.xlsx',
    );
  });

  it('lists every bin, empty ones too, and keeps only bins matching a Bin filter', async () => {
    const bs = (label: string, code: string, q: Partial<Record<string, number>> = {}) => ({
      bin: { binLabel: label, binCode: code, isVirtual: false },
      reservedQty: 0,
      availQty: 0,
      inTransitQty: 0,
      qualityIssue: 0,
      qtyIssue: 0,
      ...q,
    });
    const inv = {
      materialCode: 'M-1',
      material: { materialName: 'BOLT', primaryUom: { uomCode: 'PCS' } },
      warehouse: { name: 'Jakarta - IEL' },
      binStocks: [bs('KIT A1-01', 'K1', { availQty: 5 }), bs('Rack B', 'RB', { availQty: 2, reservedQty: 1 }), bs('Rack C', 'RC')],
    };
    const findMany = jest.fn().mockResolvedValue([inv]);
    const service = new InventoryService({ inventoryManagement: { findMany } } as never);
    const scope = { role: 'admin', warehouseIds: null };

    const all = [];
    for await (const rows of service.exportRows({}, scope)) all.push(...rows);
    expect(all.map((r) => [r.bin_label, r.qty_on_hand, r.qty_available, r.qty_freeze, r.qty_reserved])).toEqual([
      ['KIT A1-01', 5, 0, 5, 0],
      ['Rack B', 3, 2, 0, 1],
      ['Rack C', 0, 0, 0, 0],
    ]);
    expect(all[0].stock_unit_cuom).toBe('PCS');

    const kit = [];
    for await (const rows of service.exportRows({ filters: [{ field: 'bin', values: ['rb'] }] }, scope)) kit.push(...rows);
    expect(kit.map((r) => r.bin_label)).toEqual(['Rack B']);
  });
});
