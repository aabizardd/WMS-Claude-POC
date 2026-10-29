/**
 * Which warehouses a request may see. A user can be assigned several
 * warehouses (as on WMS dev) and sees all of them together; `null` means no
 * limit (an admin on "All sites"). An empty list sees nothing.
 */
export interface WarehouseScope {
  role: string;
  warehouseIds: string[] | null;
}

/** `{ [field]: { in: ids } }`, or `{}` when the scope has no limit. */
export function scopeWhere(scope: WarehouseScope): { warehouseId?: { in: string[] } };
export function scopeWhere<K extends string>(scope: WarehouseScope, field: K): { [P in K]?: { in: string[] } };
export function scopeWhere(scope: WarehouseScope, field = 'warehouseId'): Record<string, { in: string[] }> {
  if (!scope.warehouseIds) return {};
  return { [field]: { in: scope.warehouseIds } };
}

/** May this scope see a record that lives in `warehouseId`? */
export function inScope(scope: WarehouseScope, warehouseId: string | null | undefined): boolean {
  if (!scope.warehouseIds) return true;
  return !!warehouseId && scope.warehouseIds.includes(warehouseId);
}

/** The one warehouse the scope is limited to, if exactly one (a default for new records). */
export function soleWarehouse(scope: WarehouseScope): string | null {
  return scope.warehouseIds?.length === 1 ? scope.warehouseIds[0] : null;
}
