// Single source of truth for the RBAC permission catalog.
// Used by the seed to populate the `permissions` table.

export interface PermissionDef {
  resource: string;
  action: string;
  key: string;
  description: string;
}

const RESOURCES: { resource: string; label: string; actions: string[] }[] = [
  { resource: 'users', label: 'Users', actions: ['read', 'create', 'update', 'delete'] },
  { resource: 'roles', label: 'Roles', actions: ['read', 'create', 'update', 'delete'] },
  // Materials are never created/deleted in WMS (ERP-owned) — read/update/sync only.
  { resource: 'materials', label: 'Materials', actions: ['read', 'update', 'sync'] },
  {
    resource: 'material-categories',
    label: 'Material Categories',
    actions: ['read', 'create', 'update', 'delete'],
  },
  {
    resource: 'material-types',
    label: 'Material Types',
    actions: ['read', 'create', 'update', 'delete'],
  },
  { resource: 'uoms', label: 'UOM', actions: ['read', 'create', 'update', 'delete'] },
  // Warehouses are synced from Oracle (read-only mirror) — read/sync only.
  { resource: 'warehouses', label: 'Warehouses', actions: ['read', 'sync'] },
  // Vendors are synced from Oracle (read-only mirror) — read/sync only.
  { resource: 'vendors', label: 'Vendors', actions: ['read', 'sync'] },
  // Customers are synced from Oracle (read-only mirror) — read/sync only.
  { resource: 'customers', label: 'Customers', actions: ['read', 'sync'] },
  { resource: 'departments', label: 'Departments', actions: ['read', 'sync'] },
  { resource: 'classes', label: 'Classes', actions: ['read', 'sync'] },
  { resource: 'subsidiaries', label: 'Subsidiaries', actions: ['read', 'sync'] },
  {
    resource: 'area-types',
    label: 'Area Types',
    actions: ['read', 'create', 'update', 'delete'],
  },
  { resource: 'aisles', label: 'Aisles', actions: ['read', 'create', 'update', 'delete'] },
  { resource: 'shelves', label: 'Shelves', actions: ['read', 'create', 'update', 'delete'] },
  { resource: 'bins', label: 'Bins', actions: ['read', 'create', 'update', 'delete'] },
  // Inbound — MRN mirrors Oracle PIB (read/sync); Goods Receive is editable.
  { resource: 'mrn', label: 'MRN', actions: ['read', 'sync'] },
  { resource: 'goods-receive', label: 'Goods Receive', actions: ['read', 'update'] },
  // Inventory is generated automatically on receive; manual bin adjustment adds update.
  { resource: 'inventory', label: 'Inventory', actions: ['read', 'update'] },
  // Inventory Adjustment — manual qty/quality issue adjustment (create + view).
  { resource: 'inventory-adjustments', label: 'Inventory Adjustments', actions: ['read', 'create', 'approve'] },
  // Discrepancy is recorded automatically (quantity gap on receive) — read only.
  { resource: 'discrepancy', label: 'Discrepancy', actions: ['read'] },
  // Putaway generated from Goods Receive — read, create, update.
  { resource: 'putaway', label: 'Putaway', actions: ['read', 'create', 'update'] },
  // Outbound — Sales Orders mirror Oracle — read/sync only.
  { resource: 'sales-orders', label: 'Sales Orders', actions: ['read', 'sync'] },
  // Outbound — Picking generated from Sales Order — read, create (generate).
  { resource: 'picking', label: 'Picking', actions: ['read', 'create', 'update', 'delete'] },
  // Outbound — Packing generated from (Closed) Picking — read, create, update (progress).
  { resource: 'packing', label: 'Packing', actions: ['read', 'create', 'update'] },
  // Outbound — Delivery generated from Packing — read, create.
  { resource: 'delivery', label: 'Delivery', actions: ['read', 'create', 'update'] },
  // Complaint — users create & see their own; admin manages (update status).
  { resource: 'complaints', label: 'Complaints', actions: ['read', 'create', 'update'] },
  // Sync Log — view failed Oracle syncs and retry them (admin/ops).
  { resource: 'sync-logs', label: 'Sync Logs', actions: ['read', 'update'] },
];

export const PERMISSIONS: PermissionDef[] = RESOURCES.flatMap((r) =>
  r.actions.map((action) => ({
    resource: r.resource,
    action,
    key: `${r.resource}:${action}`,
    description: `${action} ${r.label.toLowerCase()}`,
  })),
);

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Read-only baseline for a basic staff role.
export const STAFF_PERMISSION_KEYS = [
  'materials:read',
  'material-categories:read',
  'material-types:read',
  'uoms:read',
  'warehouses:read',
  'area-types:read',
  'aisles:read',
  'shelves:read',
  'bins:read',
  'vendors:read',
  'customers:read',
  'departments:read',
  'classes:read',
  'subsidiaries:read',
  'mrn:read',
  'goods-receive:read',
  'inventory:read',
  'inventory-adjustments:read',
  'discrepancy:read',
  'putaway:read',
  'sales-orders:read',
  'picking:read',
  'packing:read',
  'delivery:read',
  'complaints:read',
  'complaints:create',
];

// Putaway-specific permissions for the picker role.
export const PICKER_PERMISSION_KEYS = [
  'putaway:read',
  'putaway:create',
  'putaway:update',
];
