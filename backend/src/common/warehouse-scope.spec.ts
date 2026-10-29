import { inScope, scopeWhere, soleWarehouse } from './warehouse-scope';

describe('warehouse scope', () => {
  const all = { role: 'admin', warehouseIds: null };
  const two = { role: 'staff', warehouseIds: ['wh-a', 'wh-b'] };
  const none = { role: 'staff', warehouseIds: [] };

  it('limits a query to every assigned warehouse', () => {
    expect(scopeWhere(all)).toEqual({});
    expect(scopeWhere(two)).toEqual({ warehouseId: { in: ['wh-a', 'wh-b'] } });
    expect(scopeWhere(two, 'toWarehouseId')).toEqual({ toWarehouseId: { in: ['wh-a', 'wh-b'] } });
    expect(scopeWhere(none)).toEqual({ warehouseId: { in: [] } });
  });

  it('lets a record through when it lives in any assigned warehouse', () => {
    expect(inScope(two, 'wh-b')).toBe(true);
    expect(inScope(two, 'wh-c')).toBe(false);
    expect(inScope(two, null)).toBe(false);
    expect(inScope(all, null)).toBe(true);
    expect(inScope(none, 'wh-a')).toBe(false);
  });

  it('defaults to a warehouse only when there is exactly one', () => {
    expect(soleWarehouse(two)).toBeNull();
    expect(soleWarehouse({ role: 'staff', warehouseIds: ['wh-a'] })).toBe('wh-a');
    expect(soleWarehouse(all)).toBeNull();
  });
});
