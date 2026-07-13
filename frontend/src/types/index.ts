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
  departmentId: string | null;
  department: { id: string; name: string | null } | null;
  subsidiaryId: string | null;
  subsidiary: { id: string; name: string | null; fullName: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface DepartmentOption {
  id: string;
  name: string | null;
  oracleId: string;
}

export interface SubsidiaryOption {
  id: string;
  name: string | null;
  fullName: string | null;
  oracleId: string;
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
  // Oracle-mirrored header quantities (not tracked per bin).
  qty_committed: number;
  qty_on_order: number;
  qty_back_order: number;
}

// Inventory detail is grouped by bin location (quantities summed per bin).
export interface InventoryBinGroup {
  bin_id: string | null;
  bin_location: string | null;
  warehouse_name: string | null;
  on_hand: number;
  reserved_qty: number;
  avail_qty: number;
  in_transit_qty: number;
  quality_issue: number;
  qty_issue: number;
}

export interface InventoryDetail extends InventoryRow {
  warehouse_id: string | null;
  bins: InventoryBinGroup[];
}

export interface BinOption {
  id: string;
  binLabel: string;
  binCode: string;
  warehouseId: string;
}

export interface SyncLogRow {
  id: string;
  module: string;
  trigger: string;
  status: string; // success | partial | failed
  last_modified: string | null;
  upserted: number | null;
  failed: number | null;
  total_records: number | null;
  message: string | null;
  duration_ms: number | null;
  retried_at: string | null;
  created_at: string;
}

export interface Paginated<T> {
  total_page: number;
  total_data: number;
  attributes: { page: number; limit: number; order_by: string };
  rows: T[];
}

// ===== Dashboard =====

export interface NameCount {
  status?: string;
  type?: string;
  source?: string;
  count: number;
}
export interface DashboardSummary {
  range_days: number;
  warehouse_id: string | null;
  kpis: {
    goods_receive_period: number;
    goods_receive_open: number;
    sales_order_period: number;
    sales_order_pending: number;
    sku_on_hand: number;
    on_hand_qty: number;
    adjustment_pending: number;
    discrepancy_period: number;
    complaint_open: number;
  };
  inbound: {
    throughput: { date: string; count: number }[];
    gr_status: NameCount[];
    putaway_status: NameCount[];
    funnel: { stage: string; count: number }[];
  };
  outbound: {
    throughput: { date: string; count: number }[];
    funnel: { stage: string; count: number }[];
    so_status: NameCount[];
    picking_status: NameCount[];
    packing_status: NameCount[];
    delivery_status: NameCount[];
  };
  inventory: {
    on_hand_by_warehouse: { warehouse: string; on_hand: number }[];
    top_materials: { code: string; name: string; on_hand: number }[];
    composition: { bucket: string; qty: number }[];
    low_stock: number;
    zero_stock: number;
  };
  quality: {
    discrepancy_by_type: NameCount[];
    discrepancy_by_source: NameCount[];
    adjustment_by_status: NameCount[];
    adjustment_by_type: NameCount[];
    complaint_status: NameCount[];
  };
  ops: {
    sync_by_status: NameCount[];
    last_sync_per_module: { module: string; status: string; at: string }[];
    aging: { label: string; count: number }[];
  };
}

// ===== Purchase Order (Local Vendor inbound) =====

export interface PurchaseOrderRow {
  id: string;
  oracle_id: string;
  po_number: string | null;
  po_date: string | null;
  po_status: string | null;
  po_status_label: string | null;
  vendor_name: string | null;
  currency_symbol: string | null;
  subsidiary_display: string | null;
  warehouse: { id: string; name: string } | null;
  line_count: number;
  last_modified: string | null;
  created_at: string;
}

export interface PurchaseOrderLine {
  id: string;
  line_id: string;
  item_oracle_id: string | null;
  item_display: string | null;
  item_type: string | null;
  description: string | null;
  quantity: number;
  committed: number;
  backordered: number;
  quantity_received: number;
  quantity_billed: number;
  qty_remaining_to_receive: number;
  location_name: string | null;
  department_display: string | null;
  class_display: string | null;
  inbound_shipment_number: string | null;
  material_id: string | null;
}

export interface PurchaseOrderDetail {
  id: string;
  oracle_id: string;
  po_number: string | null;
  po_date: string | null;
  po_status: string | null;
  po_status_label: string | null;
  memo: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  currency_symbol: string | null;
  approval_status_display: string | null;
  subsidiary_display: string | null;
  class_display: string | null;
  department_display: string | null;
  location_name: string | null;
  warehouse: { id: string; name: string } | null;
  created_by_netsuite: string | null;
  date_created: string | null;
  last_modified: string | null;
  created_at: string;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderSyncResult {
  fullSync: boolean;
  lastModified: string | null;
  totalRecords: number;
  totalPages: number;
  pagesFetched: number;
  upserted: number;
  skipped: number;
  failed: number;
  durationMs: number;
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

export interface Department {
  id: string;
  oracle_id: string;
  name: string | null;
  is_inactive: boolean;
  parent_id: string | null;
  parent_name: string | null;
  subsidiary_id: string | null;
  subsidiary_name: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface ClassMaster {
  id: string;
  oracle_id: string;
  name: string | null;
  is_inactive: boolean;
  parent_id: string | null;
  parent_name: string | null;
  subsidiary_id: string | null;
  subsidiary_name: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface Subsidiary {
  id: string;
  oracle_id: string;
  name: string | null;
  full_name: string | null;
  is_delete: boolean;
  last_modified: string | null;
  created_at: string;
}

// ===== Inventory Adjustment =====
export interface InventoryAdjustmentRow {
  id: string;
  adjustment_number: string;
  warehouse: string | null;
  adjustment_type: 'qty_issue' | 'quality_issue';
  status: string;
  material_count: number;
  bin_count: number;
  total_qty: number;
  discrepancy_count: number;
  oracle_id?: string;
  oracle_approval_status?: string;
  created_by: string | null;
  created_at: string;
}

export interface AdjMaterialOption {
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
}

export interface AdjBinOption {
  bin_id: string | null;
  bin_label: string | null;
  qty_available: number;
  qty_issue: number;
  quality_issue: number;
}

export interface InventoryAdjustmentItemRow {
  id: string;
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
  bin_id: string | null;
  bin_label: string | null;
  qty_adjustment: number;
  qty_scrapped: number;
  qty_passed: number;
  avail_at_create: number;
  qty_issue_at_create: number;
  quality_issue_at_create: number;
}

export interface InventoryAdjustmentDetail {
  id: string;
  adjustment_number: string;
  warehouse: string | null;
  warehouse_id: string | null;
  class_id: string | null;
  class_name: string | null;
  class_oracle_id: string | null;
  adjustment_type: 'qty_issue' | 'quality_issue';
  status: string;
  note: string | null;
  oracle_id: string;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  approval_reason: string | null;
  oracle_approval_status: string;
  total_qty: number;
  items: InventoryAdjustmentItemRow[];
  discrepancies: { id: string; discrepancy_id: string; type: string; from: string }[];
}

// Response of PUT /inventory-adjustments/:id/approve on success (approve action).
export interface AdjustmentApprovalResult extends InventoryAdjustmentDetail {
  oracle?: { message: string; inventory_adjustment_id: number };
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
  source_number: string | null;
  source: string | null;
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
  qty_discrepancy_type: string;
}

export interface DiscrepancyDetail {
  id: string;
  discrepancy_id: string;
  source_number: string | null;
  source: string | null;
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

// ===== Outbound: Sales Order =====

export interface SalesOrderRow {
  id: string;
  oracle_id: string;
  tran_id: string | null;
  tran_date: string | null;
  status_name: string | null;
  delivery_status: string;
  customer_name: string | null;
  location_name: string | null;
  warehouse: { id: string; name: string } | null;
  total_amount: number;
  item_count: number;
  last_modified: string | null;
  created_at: string;
}

export interface SalesOrderItemRow {
  id: string;
  line_number: number;
  item_oracle_id: string | null;
  item_name: string | null;
  material_code: string | null;
  material_name: string | null;
  quantity: number;
  remaining_qty: number;
  rate: number;
  amount: number;
  shipped: number;
  description: string | null;
  location_id: string | null;
}

export interface SalesOrderDetail {
  id: string;
  oracle_id: string;
  tran_id: string | null;
  tran_date: string | null;
  status_code: string | null;
  status_name: string | null;
  delivery_status: string;
  customer_id: string | null;
  customer_name: string | null;
  memo: string | null;
  location_name: string | null;
  warehouse: { id: string; name: string } | null;
  subsidiary_name: string | null;
  currency_name: string | null;
  total_amount: number;
  last_modified: string | null;
  date_created: string | null;
  created_at: string;
  items: SalesOrderItemRow[];
}

export interface SalesOrderSyncResult extends ErpSyncResult {
  unchanged: number;
}

// ===== Outbound: Picking =====

export interface PickingRow {
  id: string;
  picking_id: string;
  so_id: string | null;
  so_number: string | null;
  location: string | null;
  customer: string | null;
  status: string;
  item_count: number;
  created_at: string;
}

export interface PickingItemRow {
  id: string;
  status: string;
  material_code: string | null;
  material_name: string | null;
  bin_available_qty: number;
  request_qty: number;
  actual_qty: number;
  qty_issue: number;
  quality_issue: number;
  remaining_qty: number;
  bin_id: string | null;
  bin_label: string | null;
  picker: { id: number; name: string } | null;
}

export interface PickingTotals {
  request: number;
  actual: number;
  qty_issue: number;
  quality_issue: number;
  remaining: number;
}

export interface PickingDetail {
  id: string;
  picking_id: string;
  so_id: string | null;
  so_number: string | null;
  location: string | null;
  customer: string | null;
  status: string;
  created_at: string;
  totals: PickingTotals;
  items: PickingItemRow[];
}

// ===== Outbound: Packing =====

export interface AvailablePickingRow {
  id: string;
  picking_id: string;
  so_number: string | null;
  customer: string | null;
  location: string | null;
  item_count: number;
  created_at: string;
}

export interface PackingRow {
  id: string;
  packing_id: string;
  picking_id: string | null;
  so_number: string | null;
  customer: string | null;
  location: string | null;
  status: string;
  item_count: number;
  created_at: string;
}

export interface PackingItemRow {
  id: string;
  material_code: string | null;
  material_name: string | null;
  qty: number; // base (target to pack)
  actual_qty: number;
  qty_issue: number;
  quality_issue: number;
  remaining_qty: number;
  bin_label: string | null;
  picker: { id: number; name: string } | null;
}

export interface PackingTotals {
  request: number;
  actual: number;
  qty_issue: number;
  quality_issue: number;
  remaining: number;
}

export interface PackingDetail {
  id: string;
  packing_id: string;
  picking_id: string | null;
  so_id: string | null;
  so_number: string | null;
  customer: string | null;
  location: string | null;
  status: string;
  created_at: string;
  totals: PackingTotals;
  items: PackingItemRow[];
}

// ===== Outbound: Delivery =====

export interface DeliveryRow {
  id: string;
  delivery_id: string;
  sdo_id: string | null;
  packing_id: string | null;
  so_number: string | null;
  customer: string | null;
  location: string | null;
  status: string;
  item_count: number;
  created_at: string;
}

export interface DeliveryTracking {
  so_id: string | null;
  so_number: string | null;
  customer: string | null;
  picking_id: string | null;
  picking_code: string | null;
  picking_status: string | null;
  packing_id: string | null;
  packing_code: string | null;
  delivery_code: string;
  sdo_id: string | null;
  delivery_status: string;
}

export interface DeliveryItemRow {
  id: string;
  line_number: number | null;
  material_code: string | null;
  material_name: string | null;
  qty: number;
  uom: string | null;
  bin_label: string | null;
  picker: { id: number; name: string } | null;
}

export interface DeliveryDetail {
  id: string;
  delivery_id: string;
  sdo_id: string | null;
  packing_id: string | null;
  so_id: string | null;
  so_oracle_id: string | null;
  so_number: string | null;
  customer: string | null;
  location: string | null;
  status: string;
  oracle_fulfillment_id: number | null;
  oracle_local_id: number | null;
  created_at: string;
  tracking: DeliveryTracking;
  items: DeliveryItemRow[];
}

// Response of PUT /delivery/:id/generate-shipment — detail + Oracle result.
export interface ShipmentResult extends DeliveryDetail {
  fulfillment: {
    message: string;
    fulfillment_id: number | null;
    local_id: number | null;
  };
}

// Data for the Generate Picking form.
export interface PickableBin {
  bin_id: string | null;
  bin_label: string | null;
  avail_qty: number;
}

export interface PickableItem {
  id: string;
  line_number: number;
  item_name: string | null;
  material_code: string | null;
  material_name: string | null;
  quantity: number;
  remaining_qty: number;
  available_bins: PickableBin[];
}

export interface Pickable {
  id: string;
  tran_id: string | null;
  status_name: string | null;
  delivery_status: string;
  customer_name: string | null;
  warehouse: { id: string; name: string } | null;
  can_generate: boolean;
  items: PickableItem[];
}

// ===== Complaint =====

export interface ComplaintRow {
  id: string;
  complaint_number: string;
  menu_feature: string;
  title: string;
  email: string;
  description: string;
  status: string;
  reported_by: string | null;
  warehouse: { id: string; name: string } | null;
  created_at: string;
}

export interface ComplaintDetail extends ComplaintRow {
  evidence_count: number;
  evidences: string[];
}
