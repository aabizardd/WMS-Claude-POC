/**
 * The header bar's tabs, as on WMS dev: the page's module decides which tabs
 * show, and the tab whose path best matches the URL (detail pages included)
 * is the active one.
 */
export interface ModuleTab {
  to: string;
  label: string;
  /** Path prefixes that make this tab active (default: `to`). */
  match?: string[];
  /** Only these exact paths make it active (e.g. the dashboard's "/admin"). */
  exact?: boolean;
  /** Required permission; a list means any one of them. */
  permission?: string | string[];
  /**
   * A second row of tabs shown under the header bar while this tab is active
   * (e.g. Warehouse Setting → Warehouse … Bin). The tab is shown when any of
   * them is allowed and links to the first allowed one.
   */
  subtabs?: ModuleTab[];
  /** Line under the group title above the sub tabs (as on WMS dev). */
  description?: string;
}

export interface Module {
  /** Path prefixes that belong to this module. */
  match: string[];
  exact?: boolean;
  tabs: ModuleTab[];
}

const MASTER_PATHS = [
  '/admin/master-data',
  '/admin/ownerships',
  '/admin/users',
  '/admin/roles',
  '/admin/subsidiaries',
  '/admin/warehouses',
  '/admin/materials',
  '/admin/material-categories',
  '/admin/material-types',
  '/admin/uoms',
  '/admin/area-types',
  '/admin/aisles',
  '/admin/shelves',
  '/admin/bins',
  '/admin/vendors',
  '/admin/customers',
  '/admin/departments',
  '/admin/classes',
];

const INVENTORY_PATHS = ['/admin/inventory', '/admin/inventory-adjustments', '/admin/discrepancy'];

export const MODULES: Module[] = [
  { match: ['/admin'], exact: true, tabs: [{ to: '/admin', label: 'Dashboard', exact: true }] },

  // Inbound
  {
    match: ['/admin/inbound/transfer'],
    tabs: [
      { to: '/admin/inbound/transfer/to', label: 'Request', permission: 'transfer-orders:read' },
      { to: '/admin/inbound/transfer/goods-receive', label: 'Goods Receive', permission: 'goods-receive:read' },
      { to: '/admin/inbound/transfer/putaway', label: 'Putaway', permission: 'putaway:read' },
      { to: '/admin/inbound/transfer/history', label: 'History', permission: 'putaway:read' },
    ],
  },
  {
    match: ['/admin/inbound/pib'],
    tabs: [
      { to: '/admin/inbound/pib/mrn', label: 'MRN', permission: 'mrn:read' },
      { to: '/admin/inbound/pib/goods-receive', label: 'Goods Receive', permission: 'goods-receive:read' },
      { to: '/admin/inbound/pib/putaway', label: 'Putaway', permission: 'putaway:read' },
      { to: '/admin/inbound/pib/history', label: 'History', permission: 'putaway:read' },
    ],
  },
  {
    match: ['/admin/inbound/local'],
    tabs: [
      { to: '/admin/inbound/local/po', label: 'Request', permission: 'purchase-orders:read' },
      { to: '/admin/inbound/local/goods-receive', label: 'Goods Receive', permission: 'goods-receive:read' },
      { to: '/admin/inbound/local/putaway', label: 'Putaway', permission: 'putaway:read' },
      { to: '/admin/inbound/local/history', label: 'History' },
    ],
  },
  { match: ['/admin/inbound'], exact: true, tabs: [{ to: '/admin/inbound', label: 'Inbound Management', exact: true }] },

  // Outbound
  {
    match: ['/admin/outbound/sales-order'],
    tabs: [
      {
        to: '/admin/outbound/sales-order/list',
        label: 'Sales Order',
        match: ['/admin/outbound/sales-order/list', '/admin/outbound/sales-order/tracking'],
        permission: 'sales-orders:read',
      },
      { to: '/admin/outbound/sales-order/picking', label: 'Picking List' },
      { to: '/admin/outbound/sales-order/packing', label: 'Packing List' },
      { to: '/admin/outbound/sales-order/delivery', label: 'Delivery Plan' },
      { to: '/admin/outbound/sales-order/history', label: 'Outbound History' },
    ],
  },
  {
    match: ['/admin/outbound/transfer-stock'],
    tabs: [
      { to: '/admin/outbound/transfer-stock/list', label: 'Transfer Order', permission: 'transfer-orders:read' },
      { to: '/admin/outbound/transfer-stock/picking', label: 'Picking List' },
      { to: '/admin/outbound/transfer-stock/packing', label: 'Packing List' },
      { to: '/admin/outbound/transfer-stock/delivery', label: 'Delivery Plan' },
      { to: '/admin/outbound/transfer-stock/history', label: 'Outbound History' },
    ],
  },
  { match: ['/admin/outbound'], exact: true, tabs: [{ to: '/admin/outbound', label: 'Outbound Management', exact: true }] },

  // Inventory
  {
    match: INVENTORY_PATHS,
    tabs: [
      {
        to: '/admin/inventory/list',
        label: 'Inventory List',
        match: ['/admin/inventory/list', '/admin/inventory/reserved', '/admin/inventory/in-transit'],
        permission: 'inventory:read',
      },
      { to: '/admin/inventory-adjustments', label: 'Inventory Adjustment', permission: 'inventory-adjustments:read' },
      { to: '/admin/inventory/sales-delivery', label: 'Inventory Sales', permission: 'sales-delivery:read' },
      { to: '/admin/discrepancy', label: 'Discrepancy', permission: 'discrepancy:read' },
    ],
  },

  // Master Data, laid out as on WMS dev. "Other Master" holds the POC's
  // masters WMS dev has no tab for.
  {
    match: MASTER_PATHS,
    tabs: [
      {
        to: '/admin/users',
        label: 'User Master',
        permission: 'users:read',
        description: 'Manage users warehouse management system',
      },
      {
        to: '/admin/roles',
        label: 'Role Master',
        permission: 'roles:read',
        description: 'Manage access roles for the system',
      },
      {
        to: '/admin/ownerships',
        label: 'Ownership Setting',
        // Vendors and customers, merged into one list separated by type.
        match: ['/admin/ownerships', '/admin/vendors', '/admin/customers'],
        permission: ['vendors:read', 'customers:read'],
        description: 'Manage material owners, suppliers, and customers',
      },
      {
        to: '/admin/warehouses',
        label: 'Warehouse Setting',
        description: 'Manage warehouses, areas, aisles, shelf, and bins',
        match: ['/admin/warehouses', '/admin/area-types', '/admin/aisles', '/admin/shelves', '/admin/bins'],
        subtabs: [
          { to: '/admin/warehouses', label: 'Warehouse', permission: 'warehouses:read' },
          { to: '/admin/area-types', label: 'Area', permission: 'area-types:read' },
          { to: '/admin/aisles', label: 'Aisle', permission: 'aisles:read' },
          { to: '/admin/shelves', label: 'Shelf', permission: 'shelves:read' },
          { to: '/admin/bins', label: 'Bin', permission: 'bins:read' },
        ],
      },
      {
        to: '/admin/material-categories',
        label: 'Material Management',
        description: 'Manage material categories, types, information and values.',
        match: ['/admin/material-categories', '/admin/material-types', '/admin/materials'],
        subtabs: [
          { to: '/admin/material-categories', label: 'Categories', permission: 'material-categories:read' },
          { to: '/admin/material-types', label: 'Types', permission: 'material-types:read' },
          { to: '/admin/materials', label: 'Material Info', permission: 'materials:read' },
        ],
      },
      {
        to: '/admin/classes',
        label: 'Other Master',
        description: 'Manage classes, departments, subsidiaries, and units of measure',
        match: ['/admin/classes', '/admin/departments', '/admin/subsidiaries', '/admin/uoms'],
        subtabs: [
          { to: '/admin/classes', label: 'Class', permission: 'classes:read' },
          { to: '/admin/departments', label: 'Department', permission: 'departments:read' },
          { to: '/admin/subsidiaries', label: 'Subsidiary', permission: 'subsidiaries:read' },
          { to: '/admin/uoms', label: 'UoM', permission: 'uoms:read' },
        ],
      },
    ],
  },

  // POC-only pages (Others)
  { match: ['/admin/complaints'], tabs: [{ to: '/admin/complaints', label: 'Complaint' }] },
  { match: ['/admin/sync-logs'], tabs: [{ to: '/admin/sync-logs', label: 'Sync Logs' }] },
  { match: ['/admin/settings'], tabs: [{ to: '/admin/settings', label: 'Settings' }] },
];

export const INVENTORY_MATCH = INVENTORY_PATHS;
export const MASTER_MATCH = MASTER_PATHS;

/** Does `pathname` sit under any of these prefixes (path-segment aware)? */
export function underAny(pathname: string, prefixes: string[], exact = false) {
  return prefixes.some((p) => (exact ? pathname === p : pathname === p || pathname.startsWith(`${p}/`)));
}

export function findModule(pathname: string): Module | null {
  return MODULES.find((m) => underAny(pathname, m.match, m.exact)) ?? null;
}

/** The tab with the longest prefix matching the URL. */
export function activeTab(module: Module, pathname: string): ModuleTab | null {
  let best: ModuleTab | null = null;
  let bestLen = -1;
  for (const t of module.tabs) {
    for (const p of t.match ?? [t.to]) {
      if (underAny(pathname, [p], t.exact) && p.length > bestLen) {
        best = t;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** May the user open this tab? `has` checks a single permission. */
export function canSee(tab: ModuleTab, has: (p: string) => boolean): boolean {
  if (tab.subtabs) return tab.subtabs.some((t) => canSee(t, has));
  if (!tab.permission) return true;
  return Array.isArray(tab.permission) ? tab.permission.some(has) : has(tab.permission);
}

/**
 * The tab as the user gets it: one with sub tabs keeps only the allowed ones
 * and links to the first of them.
 */
export function visibleTabs(tabs: ModuleTab[], has: (p: string) => boolean): ModuleTab[] {
  return tabs
    .filter((t) => canSee(t, has))
    .map((t) => {
      if (!t.subtabs) return t;
      const subtabs = t.subtabs.filter((st) => canSee(st, has));
      return { ...t, to: subtabs[0].to, subtabs };
    });
}
