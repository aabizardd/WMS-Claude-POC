export interface Role {
  id: number;
  name: string;
  description?: string | null;
  userCount?: number;
  permissions?: Permission[];
  permissionIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  username: string;
  isActive: boolean;
  roleId: number;
  role: { id: number; name: string };
  warehouseId: string | null;
  warehouse: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  username: string;
  role: string;
  permissions: string[];
  warehouseId: string | null;
}

export interface Permission {
  id: string;
  key: string; // e.g. "users:create"
  resource: string; // e.g. "users"
  action: string; // read | create | update | delete | sync
  description?: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

// ===== Material Management =====

export interface Uom {
  id: string;
  uomName: string;
  uomCode: string;
  isActive: boolean;
}

export interface MaterialCategory {
  id: string;
  materialCategoryName: string;
  materialCategoryCode: string;
  description?: string | null;
  isActive: boolean;
  _count?: { materials: number };
}

export interface MaterialType {
  id: string;
  materialTypeName: string;
  materialTypeCode: string;
  description?: string | null;
  isActive: boolean;
  _count?: { materials: number };
}

// UOM as embedded in a material row (may be empty object {})
export interface UomRef {
  id?: string;
  uom_name?: string;
  uom_code?: string;
}

export interface CategoryRef {
  id?: string;
  material_category_name?: string;
  material_category_code?: string;
}

export interface TypeRef {
  id?: string;
  material_type_name?: string;
  material_type_code?: string;
}

// Material row, in the API's snake_case shape
export interface Material {
  id: string;
  erp_doc_id: string | null;
  conversion_rate_quantity: number;
  currency: string | null;
  material_category: CategoryRef;
  material_type: TypeRef;
  dimension_uom: UomRef;
  weight_uom: UomRef;
  primary_uom: UomRef;
  secondary_uom: UomRef;
  material_name: string;
  material_code: string;
  material_length: number;
  material_width: number;
  material_height: number;
  material_weight: number;
  material_qty: number;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  modified_by: string | null;
  modified_at: string;
  photos: string[];
}

// ===== Inbound: MRN & Goods Receive =====

export interface MrnItemRow {
  id: string;
  item_name: string | null;
  po_number: string | null;
  vendor_name: string | null;
  item_description: string | null;
  qty_expected: number;
  qty_received: number;
  qty_remaining: number;
  qty_actual: number;
  shipment_item_amount: number;
  receiving_location_name: string | null;
}

export interface Mrn {
  id: string;
  oracle_id: string;
  shipment_number: string | null;
  external_doc_number: string | null;
  external_id: string | null;
  status: string; // WMS status (Closed)
  oracle_status: string | null;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  memo: string | null;
  vessel_number: string | null;
  bill_of_lading: string | null;
  port: string | null;
  date_created: string | null;
  last_modified: string | null;
  receiving_location_name: string | null;
  warehouse: { id: string; name: string } | null;
  goods_receive: { id: string; gr_number: string; status: string } | null;
  items: MrnItemRow[];
  created_at: string;
}

export interface GoodsReceiveRow {
  id: string;
  gr_number: string;
  status: string;
  shipment_number: string | null;
  receiving_location_name: string | null;
  warehouse: { id: string; name: string } | null;
  item_count: number;
  created_at: string;
}

export interface GoodsReceiveItem {
  id: string;
  item_name: string | null;
  po_number: string | null;
  vendor_name: string | null;
  item_description: string | null;
  qty_expected: number;
  qty_actual: number;
  qty_remaining: number;
  bin_id: string | null;
  bin_label: string | null;
  receiving_location_name: string | null;
}

export interface GoodsReceiveDetailMrn {
  id: string;
  oracle_id: string | null;
  shipment_number: string | null;
  oracle_status: string | null;
  status: string;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  vessel_number: string | null;
  bill_of_lading: string | null;
  port: string | null;
  memo: string | null;
  date_created: string | null;
  receiving_location_name: string | null;
}

export interface GoodsReceiveDetail {
  id: string;
  gr_number: string;
  status: string;
  shipment_number: string | null;
  receiving_location_name: string | null;
  warehouse: { id: string; name: string } | null;
  mrn: GoodsReceiveDetailMrn;
  items: GoodsReceiveItem[];
  created_at: string;
}

export interface GoodsReceiptResultItem {
  item_id: string;
  item_name: string;
}

export interface GoodsReceiptResult {
  id: string;
  tranid: string;
  trandate: string;
  po_id: string;
  po_number: string;
  items: GoodsReceiptResultItem[];
}

export interface ReceiveResult {
  inboundShipmentId: number;
  inboundShipmentStatus: string;
  goodsReceipts: GoodsReceiptResult[];
  pollingAttempts: number;
  durationMs: number;
}

// ===== Inventory Management =====

export interface InventoryRow {
  id: string;
  material_name: string | null;
  material_code: string;
  material_type: string | null;
  material_category: string | null;
  primary_uom: string | null;
  warehouse_name: string | null;
  reserved_qty: number;
  avail_qty: number;
  in_transit_qty: number;
  quality_issue: number;
  qty_issue: number;
  on_hand: number;
}

export interface InventoryBatch {
  id: string;
  reserved_qty: number;
  avail_qty: number;
  in_transit_qty: number;
  quality_issue: number;
  qty_issue: number;
  on_hand: number;
  warehouse_name: string | null;
  bin_location: string | null;
  gr_number: string | null;
  company_name: string | null;
  created_at: string;
}

export interface InventoryDetail extends InventoryRow {
  batches: InventoryBatch[];
}

export interface Paginated<T> {
  total_page: number;
  total_data: number;
  attributes: { page: number; limit: number; order_by: string };
  rows: T[];
}

export interface ErpSyncResult {
  fullSync: boolean;
  lastModified: string | null;
  totalRecords: number;
  totalPages: number;
  pagesFetched: number;
  upserted: number;
  failed: number;
  durationMs: number;
}

// ===== Warehouse Management =====

export interface Warehouse {
  id: string;
  oracle_id: string;
  name: string;
  is_inactive: boolean;
  parent_id: string | null;
  parent_name: string | null;
  subsidiary_id: string | null;
  subsidiary_name: string | null;
  location_type: string | null;
  location_type_name: string | null;
  timezone: string | null;
  make_inventory_available: boolean;
  last_modified: string | null;
  created_at: string;
}

export interface WarehouseOption {
  id: string;
  name: string;
  oracleId: string;
}

export interface AreaType {
  id: string;
  areaTypeName: string;
  areaTypeCode: string;
  isActive: boolean;
  _count?: { bins: number };
}

export interface Aisle {
  id: string;
  aisleName: string;
  aisleCode: string;
  isActive: boolean;
  _count?: { bins: number };
}

export interface Shelf {
  id: string;
  shelfLabel: string;
  shelfCode: string;
  isActive: boolean;
  _count?: { bins: number };
}

export interface Vendor {
  id: string;
  oracle_id: string;
  entity_id: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  terms: string | null;
  terms_display: string | null;
  subsidiary: string | null;
  subsidiary_display: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  oracle_id: string;
  entity_id: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface Bin {
  id: string;
  shelf_id: string;
  aisle_id: string;
  warehouse_id: string;
  area_type_id: string;
  dimension_uom_id: string | null;
  bin_label: string;
  bin_code: string;
  bin_length: number;
  bin_width: number;
  bin_height: number;
  max_capacity: number;
  shelf: { shelf_label: string; shelf_code: string };
  aisle: { aisle_name: string; aisle_code: string };
  warehouse_name: { warehouse_name: string; warehouse_code: string };
  warehouse_area_type: { area_type_name: string; area_type_code: string };
  dimension_uom: { uom_name?: string; uom_code?: string };
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  modified_by: string | null;
  modified_at: string | null;
}

export interface DiscrepancyRow {
  id: string;
  discrepancy_id: string;
  gr_number: string | null;
  discrepancy_type: string;
  discrepancy_from: string;
  reported_by: string | null;
  warehouse_name: string | null;
  detail_count: number;
  created_at: string;
}

export interface DiscrepancyDetailItem {
  id: string;
  po_number: string;
  item_name: string | null;
  source_from: string;
  qty_discrepancy: number;
  qty_passed: number;
  qty_scrapped: number;
  qty_remaining: number;
  qty_discrepancy_type: string;
}

export interface DiscrepancyDetail {
  id: string;
  discrepancy_id: string;
  gr_number: string | null;
  discrepancy_type: string;
  discrepancy_from: string;
  reported_by: string | null;
  warehouse_name: string | null;
  created_at: string;
  details: DiscrepancyDetailItem[];
}

export interface PutawayRow {
  id: string;
  putaway_code: string;
  gr_number: string | null;
  warehouse_name: string | null;
  status: string;
  item_count: number;
  created_at: string;
}

export interface PutawayItemDetail {
  id: string;
  mrn_item_id: string;
  item_name: string | null;
  po_number: string | null;
  material_code: string | null;
  vendor_name: string | null;
  planned_qty: number;
  actual_qty: number;
  quality_issue: number;
  qty_issue: number;
  remaining_qty: number;
  bin_id: string | null;
  bin_label: string | null;
  qty_remaining: number;
  picker: { id: number; name: string } | null;
}

export interface PutawayDetail {
  id: string;
  putaway_code: string;
  gr_number: string | null;
  warehouse_name: string | null;
  warehouse_id: string | null;
  status: string;
  created_at: string;
  items: PutawayItemDetail[];
}
