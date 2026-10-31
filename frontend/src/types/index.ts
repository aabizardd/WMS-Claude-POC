export interface Role {
  id: number;
  name: string;
  description?: string | null;
  /** Inactive roles cannot be assigned, and their users are refused access. */
  isActive?: boolean;
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
  employeeId?: string | null;
  isActive: boolean;
  roleId: number;
  role: { id: number; name: string };
  /** Every warehouse the user works in (sorted by name). */
  warehouseIds: string[];
  warehouses: { id: string; name: string }[];
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
  /** The warehouses the user is assigned; a non-admin sees all of them together. */
  warehouseIds: string[];
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
  /** FR-IA-11 rule 4: false = whole-unit measure, decimals rejected. */
  allowsDecimal?: boolean;
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
  /** Nomor Aju: the PIB's customs registration number (Oracle custrecord_msi_aju_no). */
  aju_number: string | null;
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
  /** PN / material code of the received line. */
  material_code?: string | null;
  /** The material's primary UoM code. */
  uom?: string | null;
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
  source_type: string;
  shipment_number: string | null;
  receiving_location_name: string | null;
  warehouse: { id: string; name: string } | null;
  mrn: GoodsReceiveDetailMrn;
  items: GoodsReceiveItem[];
  // TO source only: the Transfer Order being received (Inbound from Transfer Stock).
  to?: {
    id: string;
    oracle_id: string | null;
    tran_id: string | null;
    status_name: string | null;
    origin_warehouse: string | null;
    destination_warehouse: string | null;
  } | null;
  // PO source only: PO header + the received lines submitted to Oracle.
  po: {
    id: string;
    oracle_id: string;
    po_number: string | null;
    po_date: string | null;
    vendor_name: string | null;
    po_status: string | null;
    po_status_label: string | null;
    location_name: string | null;
  } | null;
  po_items: {
    id: string;
    line_number: number | null;
    item_display: string | null;
    qty_actual: number;
  }[];
  created_at: string;
}

// Result of POST /goods-receive/generate-from-po.
export interface GenerateGrFromPoResult {
  id: string;
  gr_number: string;
  oracle_receipt_id: number | null;
  po_number: string | null;
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
  secondary_uom?: string | null;
  /** The material's Oracle internal id. */
  erp_doc_id?: string | null;
  warehouse_name: string | null;
  reserved_qty: number;
  avail_qty: number;
  /** Usable stock: the bins' available total minus freeze_qty. */
  freeze_qty: number;
  /** The bins' available total, frozen (KIT) stock included. */
  avail_in_bins: number;
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
  bin_code?: string | null;
  /** True for the auto-created per-warehouse bin that holds unplaced stock. */
  is_virtual: boolean;
  /** True for a KIT bin: its stock is frozen and reported as freeze_qty. */
  is_frozen: boolean;
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

/** One "from bin -> to bin" move made by Transfer Bins. */
export interface InventoryTransfer {
  id: string;
  created_at: string;
  from_bin: { bin_id: string | null; bin_code: string | null; bin_label: string | null };
  to_bin: { bin_id: string | null; bin_code: string | null; bin_label: string | null };
  qty: number;
  adjusted_by: string | null;
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
  /** Oracle status code (e.g. "pendingReceipt") and its label. */
  po_status: string | null;
  po_status_label: string | null;
  /** What the Request screens show: "On Progress" while a GR is open, else the Oracle label. */
  status: string | null;
  vendor_name: string | null;
  ownership: string | null;
  location_name: string | null;
  warehouse: { id: string; name: string } | null;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  last_modified_by: string | null;
  last_modified: string | null;
  line_count: number;
  /** With include_items: the PO's lines for the list's accordion. */
  items?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  id: string;
  line_id: string;
  // Oracle line number (1..n) — the "line" used for item-receipt.
  line_number: number | null;
  item_display: string | null;
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  uom: string | null;
  quantity: number;
  /** On GR Lists not received yet. */
  gr_qty: number;
  /** Received in Oracle. */
  receive_qty: number;
  /** Still to put on a GR List. */
  remain_qty: number;
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderRow, 'items' | 'line_count'> {
  lines: PurchaseOrderLine[];
}

export type PurchaseOrderFilterField =
  | 'material_code'
  | 'warehouse'
  | 'created_at'
  | 'material_name'
  | 'transaction_id'
  | 'erp_doc_id';

export interface PurchaseOrderFilter {
  field: PurchaseOrderFilterField;
  values: string[];
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

// ===== Transfer Order (Outbound from Transfer Stock) =====

export interface TransferOrderRow {
  id: string;
  oracle_id: string;
  tran_id: string | null;
  tran_date: string | null;
  status_code: string | null;
  status_name: string | null;
  from_location_name: string | null;
  to_location_name: string | null;
  warehouse: { id: string; name: string } | null;
  item_count: number;
  /** Subsidiary of the origin warehouse, shown as Ownership. */
  ownership?: string | null;
  memo?: string | null;
  created_by?: string | null;
  last_modified_by?: string | null;
  last_modified: string | null;
  created_at: string;
  /** The order's lines, when asked for with include_items. */
  items?: TransferOrderLine[];
}

/** One Transfer Order list filter: values OR-ed, fields AND-ed. */
export type TransferOrderFilterField =
  | 'material_code'
  | 'from_warehouse_id'
  | 'created_at'
  | 'tran_id'
  | 'to_warehouse_id'
  | 'oracle_id'
  | 'memo'
  /** Free text on the origin / destination warehouse names. */
  | 'from_warehouse_name'
  | 'to_warehouse_name';

export interface TransferOrderFilter {
  field: TransferOrderFilterField;
  values: string[];
}

export interface TransferOrderLine {
  id: string;
  line_number: number;
  item_oracle_id: string | null;
  item_name: string | null;
  material_name: string | null;
  material_code: string | null;
  description: string | null;
  quantity: number;
  committed: number;
  backordered: number;
  shipped: number;
  picked: number;
  packed: number;
  fulfilled: number;
  received: number;
  from_location_name: string | null;
  material_id: string | null;
  // Detail page only.
  uom?: string | null;
  /** Pickable stock of the material in the origin warehouse. */
  available_qty?: number;
  /** Already sent to picking. */
  given_qty?: number;
  remaining_qty?: number;
  /** Shipped through closed deliveries. */
  actual_delivery?: number;
  /** Inbound (TO In) only. */
  material_type?: string | null;
  material_category?: string | null;
  shipped_qty?: number;
  gr_qty?: number;
  receive_qty?: number;
  remain_qty?: number;
}

export interface TransferOrderDetail {
  /** WMS's outbound number ("TO ID"). */
  outbound_id?: string | null;
  /** False when the user's warehouse is only the destination (view only). */
  can_pick?: boolean;
  id: string;
  oracle_id: string;
  tran_id: string | null;
  tran_date: string | null;
  status_code: string | null;
  status_name: string | null;
  from_location_name: string | null;
  to_location_name: string | null;
  warehouse: { id: string; name: string } | null;
  ownership?: string | null;
  created_by?: string | null;
  last_modified_by?: string | null;
  memo: string | null;
  date_created: string | null;
  last_modified: string | null;
  created_at: string;
  items: TransferOrderLine[];
}

export interface TransferOrderSyncResult {
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

/** A row of Ownership Setting: a vendor or a customer, told apart by `type`. */
export type OwnershipType = 'Vendor' | 'Customer';
export interface Ownership {
  id: string;
  type: OwnershipType;
  oracle_id: string;
  entity_id: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  /** Vendors only; customers carry no subsidiary. */
  subsidiary_display: string | null;
  last_modified: string | null;
  created_at: string;
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

// ===== Inventory Adjustment (PRD-06) =====
export type IaType =
  | 'DiscrepancyQuantity'
  | 'DiscrepancyQuality'
  | 'QualityAdjustment'
  | 'Assembly'
  | 'Disassembly'
  | 'CycleCount'
  | 'StockOpname';

export type IaStatus =
  | 'WaitingApproval'
  | 'Approved'
  | 'Rejected'
  | 'WaitingOracleApproval'
  | 'Completed'
  | 'RejectedByOracle';

/** How a line's qty fields behave for the chosen type. */
export type IaQtyMode = 'auto_negative' | 'passed_non_passed' | 'free_signed';

/** GET /inventory-adjustments/types — the behaviour matrix, straight from the server. */
export interface IaTypeInfo {
  value: IaType;
  label: string;
  qty_mode: IaQtyMode;
  filter_bucket: 'qty_issue' | 'quality_issue' | 'none';
  discrepancy_list: false | 'quantity' | 'quality';
  oracle_hit: 'always' | 'conditional';
}

/** One list row: a document in one of its warehouses. */
export interface InventoryAdjustmentRow {
  /** "{adjustment_id}:{warehouse_id}" — unique per row. */
  id: string;
  adjustment_id: string;
  adjustment_number: string;
  warehouse_id: string;
  warehouse: string | null;
  warehouse_parent: string | null;
  /** Warehouses the whole document spans. */
  warehouse_count: number;
  adjustment_type: IaType;
  adjustment_type_label: string;
  status: IaStatus;
  material_count: number;
  bin_count: number;
  total_qty: number;
  discrepancy_count: number;
  class_name: string | null;
  department_name: string | null;
  ownership: string | null;
  oracle_id?: string;
  oracle_approval_status?: string;
  oracle_error?: string | null;
  created_by: string | null;
  created_at: string;
  /** Every line, for the list's accordion. */
  items: InventoryAdjustmentItemRow[];
}

/** List filter fields; all free text except created_at (a date range). */
export type IaFilterField =
  | 'material_code'
  | 'warehouse'
  | 'created_at'
  | 'bin'
  | 'material_name'
  | 'type'
  | 'created_by';
export interface IaFilter {
  field: IaFilterField;
  values: string[];
}

export interface AdjMaterialOption {
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
  uom_code?: string | null;
  allows_decimal?: boolean;
  /** Stock in the type's bucket across the user's warehouses. */
  in_stock?: number;
  bin_count?: number;
}

/** Another document still waiting to take stock from a bin. */
export interface AdjPendingDoc {
  id: string;
  adjustment_number: string;
  status: string;
  qty: number;
  created_by: string | null;
}

export interface AdjBinOption {
  bin_id: string | null;
  bin_code: string | null;
  bin_label: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_parent: string | null;
  /** Reductions on pending documents; a new one may not use them. */
  pending_qty: number;
  pending_docs: AdjPendingDoc[];
  qty_available: number;
  qty_issue: number;
  quality_issue: number;
  /** Read-only value the Discrepancy types will store for this bin. */
  suggested_qty_adjustment: number | null;
}

/** FR-IA-10: a discrepancy that may be attached as a reference. */
export interface AdjDiscrepancyOption {
  id: string;
  discrepancy_id: string;
  type: string;
  from: string;
  /** false = matched on the material only; this discrepancy has no bin reference. */
  bin_matched: boolean;
  created_at: string;
}

export interface InventoryAdjustmentItemRow {
  id: string;
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_parent: string | null;
  bin_id: string | null;
  bin_code: string | null;
  bin_label: string | null;
  /** The bin's bucket (Available, or the Issue bucket) when the document was made. */
  before_qty: number;
  qty_adjustment: number;
  qty_passed: number;
  qty_non_passed: number;
  avail_at_create: number;
  qty_issue_at_create: number;
  quality_issue_at_create: number;
}

/** FR-IA-13 rule 8 / FR-IA-16 rule 6: one Oracle call, recorded verbatim. */
export interface InventoryAdjustmentIntegrationLog {
  id: string;
  operation: 'post' | 'status_check';
  endpoint: string;
  request: unknown;
  response: unknown;
  http_status: number | null;
  ok: boolean;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

/** FR-IA-15: one entry of the append-only audit trail. */
export interface InventoryAdjustmentEvent {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor: string | null;
  message: string | null;
  created_at: string;
}

export interface InventoryAdjustmentDetail {
  id: string;
  adjustment_number: string;
  warehouse: string | null;
  warehouse_id: string | null;
  ownership: string | null;
  department_id: string | null;
  department_name: string | null;
  class_id: string | null;
  class_name: string | null;
  class_oracle_id: string | null;
  adjustment_type: IaType;
  adjustment_type_label: string;
  qty_mode: IaQtyMode;
  status: IaStatus;
  memo: string | null;
  /** Exactly what Oracle receives: "{IA Type} | {memo}". */
  oracle_memo: string;
  oracle_id: string;
  oracle_approval_status: string;
  oracle_sent_at: string | null;
  oracle_error: string | null;
  oracle_reject_reason: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  approval_reason: string | null;
  total_qty: number;
  items: InventoryAdjustmentItemRow[];
  discrepancies: { id: string; discrepancy_id: string; type: string; from: string }[];
  events: InventoryAdjustmentEvent[];
  integration_logs: InventoryAdjustmentIntegrationLog[];
}

/** Response of PUT /inventory-adjustments/:id/check-oracle. */
export interface AdjustmentOracleCheckResult extends InventoryAdjustmentDetail {
  oracle_check?: { found: boolean; status?: string; message: string };
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
  // Which document the discrepancy originates from — drives the source filter.
  source_type: 'SO' | 'TO' | 'GR' | null;
  // Outbound: the originating SO/TO number. Inbound: the GR number.
  source_number: string | null;
  source: string | null;
  // Sales Order / Transfer Order number for outbound discrepancies — exactly one
  // is set (null for inbound). Used to group the list per source document.
  so_number: string | null;
  to_number: string | null;
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
  source_type: 'SO' | 'TO' | 'GR' | null;
  // Outbound: the originating SO/TO number. Inbound: the GR number.
  source_number: string | null;
  source: string | null;
  so_number: string | null;
  to_number: string | null;
  // Detail-only: the process that raised it ('Picking' | 'Packing' | 'Goods
  // Receive') and the linked picking document.
  source_process: string | null;
  picking_code: string | null;
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
  /** The order's subsidiary, shown as Ownership. */
  ownership?: string | null;
  created_by?: string | null;
  last_modified_by?: string | null;
  last_modified: string | null;
  created_at: string;
  /** With include_items: the order's lines for the list's accordion. */
  items?: SalesOrderItemRow[];
}

export interface SalesOrderItemRow {
  id: string;
  line_number: number;
  item_oracle_id: string | null;
  item_name: string | null;
  material_code: string | null;
  material_name: string | null;
  uom?: string | null;
  /** Pickable stock of the material in the order's warehouse. */
  available_qty?: number;
  quantity: number;
  /** Already sent to picking. */
  given_qty?: number;
  remaining_qty: number;
  /** Shipped through closed deliveries. */
  actual_delivery?: number;
  rate: number;
  amount: number;
  shipped: number;
  description: string | null;
  location_id: string | null;
}

export interface SalesOrderDetail {
  id: string;
  oracle_id: string;
  /** WMS's outbound number ("SO ID"). */
  outbound_id?: string | null;
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
  /** The order's subsidiary, shown as Ownership. */
  ownership?: string | null;
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

/** Header fields every picking / packing screen shows (as on WMS dev). */
export interface OutboundDocHeader {
  id: string;
  source_type: 'SALES_ORDER' | 'TRANSFER_ORDER';
  so_id: string | null;
  so_number: string | null;
  to_id: string | null;
  to_number: string | null;
  /** The order's Transaction ID (SO or TO). */
  source_number: string | null;
  /** WMS's outbound number of the order ("SO ID"). */
  outbound_id: string | null;
  location: string | null;
  warehouse_id: string | null;
  ownership: string | null;
  /** SO: the customer; TO: the destination warehouse. */
  customer: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

/** "10/12" — done out of total. */
export interface Progress {
  done: number;
  total: number;
}

export interface PickingItemRow {
  id: string;
  status: string;
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  uom: string | null;
  bin_available_qty: number;
  request_qty: number;
  actual_qty: number;
  qty_issue: number;
  quality_issue: number;
  remaining_qty: number;
  progress: Progress;
  bin_id: string | null;
  bin_label: string | null;
  shelf_label: string | null;
  aisle_name: string | null;
  picker: { id: number; name: string } | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface PickingRow extends OutboundDocHeader {
  picking_id: string;
  erp_doc_id: string | null;
  item_count: number;
  progress: Progress;
  /** With include_items: the lines for the list's accordion. */
  items?: PickingItemRow[];
}

export interface PickingTotals {
  request: number;
  actual: number;
  qty_issue: number;
  quality_issue: number;
  remaining: number;
}

export interface PickingDetail extends OutboundDocHeader {
  picking_id: string;
  erp_doc_id: string | null;
  /** TO source: where the stock goes. */
  destination: string | null;
  totals: PickingTotals;
  items: PickingItemRow[];
}

/** Fields the Picking / Packing lists and Outbound History filter on. */
export type OutboundDocFilterField =
  | 'material_code'
  | 'material_name'
  | 'warehouse_name'
  | 'customer_name'
  | 'tran_id'
  | 'outbound_id'
  | 'picking_code'
  | 'packing_code'
  | 'delivery_code'
  | 'created_by_name';

export interface OutboundDocFilter {
  field: OutboundDocFilterField;
  values: string[];
}

// ===== Outbound: Packing =====

export interface PackingItemRow {
  id: string;
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  material_weight: number | null;
  uom: string | null;
  qty: number; // base (target to pack)
  actual_qty: number;
  qty_issue: number;
  quality_issue: number;
  remaining_qty: number;
  bin_label: string | null;
  picker: { id: number; name: string } | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface PackingRow extends OutboundDocHeader {
  packing_id: string;
  /** The primary picking. */
  picking_id: string | null;
  /** Every picking merged into the packing, primary first. */
  pickings: { id: string; picking_id: string }[];
  item_count: number;
  items?: PackingItemRow[];
}

export interface PackingTotals {
  request: number;
  actual: number;
  qty_issue: number;
  quality_issue: number;
  remaining: number;
}

export interface PackingDetail extends Omit<PackingRow, 'items' | 'item_count'> {
  totals: PackingTotals;
  items: PackingItemRow[];
}

// ===== Outbound: History (one row per picked material, as on WMS dev) =====

export interface OutboundHistoryRow {
  id: string;
  outbound_id: string | null;
  source_number: string | null;
  picking_id: string;
  packing_id: string | null;
  delivery_id: string | null;
  sd_number: string | null;
  erp_doc_id: string | null;
  doc_type: string;
  ownership: string | null;
  warehouse: string | null;
  customer: string | null;
  material_code: string | null;
  material_name: string | null;
  material_category: string | null;
  material_classification: string | null;
  uom: string | null;
  request_qty: number;
  picked_qty: number;
  packed_qty: number;
  delivered_qty: number;
  material_dimension: string | null;
  material_weight: number | null;
  created_by: string | null;
  created_at: string;
}

// ===== Outbound: Delivery =====

export interface DeliveryRow {
  id: string;
  delivery_id: string;
  sdo_id: string | null;
  source_type: 'SALES_ORDER' | 'TRANSFER_ORDER';
  /** The packing the document was generated from first. */
  packing_id: string | null;
  /** Every packing this delivery covers — it can be more than one. */
  packing_codes?: string[];
  so_number: string | null;
  to_number: string | null;
  source_number: string | null;
  customer: string | null;
  location: string | null;
  status: string;
  item_count: number;
  /** Packing's own id, for linking to its detail. */
  packing_db_id?: string | null;
  /** Oracle id of the SO/TO behind the delivery. */
  erp_doc_id?: string | null;
  ownership?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
  /** Present when the list is asked for them (include_items=true). */
  items?: DeliveryItemRow[];
}

/** One SD Tracking filter: several values are OR-ed, fields are AND-ed. */
export type DeliveryFilterField =
  | 'material_code'
  | 'material_name'
  | 'warehouse_id'
  /** Transfer Order deliveries: the TO's destination warehouse. */
  | 'to_warehouse_id'
  /** Free text on names (the Delivery Plan filter fields). */
  | 'warehouse_name'
  | 'to_warehouse_name'
  | 'customer_name'
  | 'created_by_name'
  | 'sdo_id'
  | 'tran_id'
  | 'customer_id'
  | 'oracle_id'
  | 'packing_code'
  | 'created_by_id';

export interface DeliveryFilter {
  field: DeliveryFilterField;
  values: string[];
}

export interface DeliveryTracking {
  // Step 1 of the chain is the Sales Order or the Transfer Order, per source_type.
  source_type: 'SALES_ORDER' | 'TRANSFER_ORDER';
  so_id: string | null;
  so_number: string | null;
  to_id: string | null;
  to_number: string | null;
  // Customer for SO; destination warehouse for TO.
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
  /** Which packing this line came from — one delivery can cover several. */
  packing_id: string | null;
  packing_code: string | null;
  material_code: string | null;
  material_name: string | null;
  qty: number;
  uom: string | null;
  /** Staging bin for this line. */
  bin_label: string | null;
  /** The bins this line was picked from. */
  picked_bins?: string[];
  picker: { id: number; name: string } | null;
}

export interface DeliveryDetail {
  id: string;
  delivery_id: string;
  sdo_id: string | null;
  source_type: 'SALES_ORDER' | 'TRANSFER_ORDER';
  /** The packing the document was generated from first. */
  packing_id: string | null;
  /** Every packing this delivery covers — it can be more than one. */
  packing_codes?: string[];
  so_id: string | null;
  so_oracle_id: string | null;
  so_number: string | null;
  to_id: string | null;
  to_oracle_id: string | null;
  to_number: string | null;
  source_number?: string | null;
  customer: string | null;
  location: string | null;
  status: string;
  oracle_fulfillment_id: number | null;
  oracle_local_id: number | null;
  packing_db_id?: string | null;
  erp_doc_id?: string | null;
  ownership?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
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
  /** The material's primary UoM code. */
  uom?: string | null;
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

// ===== Inventory Sales Delivery =====

/** Every created document is Success; Failed is reserved for the Oracle post. */
export type SalesDeliveryStatus = 'Success' | 'Failed';

/** A return reverses a delivery; both live in the same list. */
export type SalesDeliveryDocumentType = 'SalesDelivery' | 'SalesReturn';

/** GET /sales-delivery/form-options — header defaults and dropdowns. */
export interface SalesDeliveryFormOptions {
  /** Shared by From and To; the form hides whichever one is picked on the other side. */
  warehouse_options: { id: string; name: string; oracle_id: string }[];
  /** A Sales Return is raised FROM one of these. */
  billing_warehouse_options: { id: string; name: string; oracle_id: string }[];
  customer_options: { id: string; name: string | null; entity_id: string | null }[];
  department_options: { id: string; name: string | null; oracle_id: string }[];
  class_options: { id: string; name: string | null; oracle_id: string }[];
  default_from_warehouse_id: string | null;
  default_department_id: string | null;
}

export interface SdMaterialOption {
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
  uom_code?: string | null;
  allows_decimal?: boolean;
  /** Sum of the transferable bins' available qty. */
  qty_available?: number;
}

export interface SdBinOption {
  bin_id: string | null;
  bin_label: string | null;
  bin_code?: string | null;
  qty_available: number;
  reserved_qty: number;
  qty_issue: number;
  quality_issue: number;
}

export interface SalesDeliveryRow {
  id: string;
  delivery_number: string;
  document_type: SalesDeliveryDocumentType;
  source_delivery_number: string | null;
  status: SalesDeliveryStatus;
  /** NetSuite internal id (a generated dummy in the POC). */
  netsuite_id: string | null;
  from_warehouse: string | null;
  to_warehouse: string | null;
  customer: string | null;
  department: string | null;
  class: string | null;
  material_count: number;
  total_qty: number;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  /** Present when the list is asked for them (include_items=true). */
  items?: SalesDeliveryItem[];
}

export interface SalesDeliveryItem {
  id: string;
  material_id: string | null;
  material_code: string | null;
  material_name: string | null;
  uom_code: string | null;
  bin_id: string | null;
  bin_label: string | null;
  bin_code?: string | null;
  /** Free note typed for this bin line on the create form. */
  remarks: string | null;
  qty_transfer: number;
  avail_at_create: number;
}

export interface SalesDeliveryDetail {
  id: string;
  delivery_number: string;
  document_type: SalesDeliveryDocumentType;
  source_delivery_id: string | null;
  source_delivery_number: string | null;
  status: SalesDeliveryStatus;
  /** NetSuite internal id (a generated dummy in the POC). */
  netsuite_id: string | null;
  from_warehouse_id: string;
  from_warehouse: string | null;
  to_warehouse_id: string;
  to_warehouse: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_entity_id: string | null;
  department_id: string | null;
  department_name: string | null;
  department_oracle_id: string | null;
  class_id: string | null;
  class_name: string | null;
  class_oracle_id: string | null;
  /** Stored composed: "{memo typed on the form} | {SD number}". */
  memo: string | null;
  created_by: string | null;
  created_at: string;
  total_qty: number;
  items: SalesDeliveryItem[];
}

// ===== Inventory list filters =====

/** Columns the inventory list can be filtered on (mirrors the server list). */
export type InventoryFilterField =
  | 'material_code'
  | 'material_name'
  | 'material_type'
  | 'material_category'
  | 'primary_uom'
  /** Matched on the warehouse id (older links). */
  | 'warehouse_id'
  /** Free text on the warehouse name. */
  | 'warehouse_name'
  | 'bin';

export interface InventoryFilter {
  field: InventoryFilterField;
  /** Several values on one column mean "any of these" (OR). */
  values: string[];
}

// ===== Sales Order list filters =====

/** Columns the Sales Order list can be filtered on (mirrors the server list). */
export type SalesOrderFilterField =
  | 'tran_id'
  | 'oracle_id'
  | 'customer_name'
  /** Matched on the warehouse id — the field is a dropdown, not free text. */
  /** Free text on the warehouse name. */
  | 'warehouse_name'
  | 'warehouse_id'
  | 'status_name'
  | 'delivery_status'
  | 'memo'
  | 'item_name'
  | 'material_code'
  | 'material_name'
  | 'item_description'
  /** Value is a "from..to" date range on created_at. */
  | 'created_at';

export interface SalesOrderFilter {
  field: SalesOrderFilterField;
  /** Several values on one column mean "any of these" (OR). */
  values: string[];
}

// ===== Sales Delivery list filters =====

/** Columns the Sales Delivery list can be filtered on (mirrors the server). */
export type SalesDeliveryFilterField =
  | 'delivery_number'
  | 'netsuite_id'
  | 'document_type'
  | 'from_warehouse'
  /** Exact Origin warehouse id (tracking dropdown). */
  | 'from_warehouse_id'
  | 'to_warehouse'
  | 'customer'
  | 'department'
  | 'class'
  | 'status'
  | 'memo'
  | 'created_by'
  /** Exact creator user id (tracking dropdown). */
  | 'created_by_id'
  /** Value is a "from..to" date range on created_at. */
  | 'created_at'
  | 'material_code'
  | 'material_name'
  | 'bin'
  | 'remarks';

export interface SalesDeliveryFilter {
  field: SalesDeliveryFilterField;
  /** Several values on one column mean "any of these" (OR). */
  values: string[];
}

// ---------- Transfer IN (Inbound from Transfer Order), as WMS dev lays it out ----------

export interface TransferMaterialFields {
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  uom: string | null;
  material_length: number | null;
  material_width: number | null;
  material_height: number | null;
  material_weight: number | null;
}

export interface TransferGrRow {
  id: string;
  status: string;
  to_id: string;
  transaction_id: string | null;
  gr_number: string;
  erp_doc_id: string | null;
  document_type: string;
  ownership: string | null;
  warehouse: string | null;
  /** Transfer IN: where the stock comes from. */
  origin_warehouse?: string | null;
  /** Local Vendor: the PO's vendor. */
  supplier?: string | null;
  item_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** With include_items: the GR's lines for the list's accordion. */
  items?: TransferGrListLine[];
}

/** A GR line in the list's accordion: material info and every qty bucket. */
export interface TransferGrListLine {
  id: string;
  line_number: number | null;
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  uom: string | null;
  planned_qty: number;
  actual_qty: number;
  putaway_qty: number;
  remain_qty: number;
}

export type TransferGrFilterField =
  | 'material_code'
  | 'origin_warehouse'
  | 'warehouse'
  | 'created_at'
  | 'material_name'
  | 'transaction_id'
  | 'destination_warehouse'
  | 'erp_doc_id'
  | 'created_by';

export interface TransferGrFilter {
  field: TransferGrFilterField;
  values: string[];
}

export interface TransferGrItem extends TransferMaterialFields {
  id: string;
  line_number: number | null;
  planned_qty: number;
  actual_qty: number;
  putaway_qty: number;
  remain_qty: number;
}

export interface TransferGrDetail extends Omit<TransferGrRow, 'warehouse' | 'item_count'> {
  warehouse: { id: string; name: string } | null;
  can_receive: boolean;
  can_delete: boolean;
  items: TransferGrItem[];
}

export interface TransferPutawayRow {
  id: string;
  status: string;
  transaction_id: string | null;
  putaway_code: string;
  gr_id: string | null;
  gr_number: string | null;
  destination_location: string | null;
  ownership: string | null;
  warehouse: string | null;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
}

export interface TransferPutawayItem extends TransferMaterialFields {
  id: string;
  line_number: number | null;
  planned_qty: number;
  actual_qty: number;
  quality_issue: number;
  qty_issue: number;
  remaining_qty: number;
  picker: { id: number; name: string } | null;
  bin: { id: string; label: string } | null;
}

export interface TransferPutawayDetail extends Omit<TransferPutawayRow, 'warehouse' | 'destination_location'> {
  warehouse: { id: string; name: string } | null;
  can_putaway: boolean;
  items: TransferPutawayItem[];
}

export interface TransferHistoryRow {
  id: string;
  transaction_id: string | null;
  gr_number: string | null;
  putaway_code: string;
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  request_qty: number;
  receive_qty: number;
  warehouse: string | null;
  destination_bin: string | null;
  origin_warehouse?: string | null;
  supplier?: string | null;
  ownership: string | null;
  created_at: string;
}

// ---------- Inbound from PIB, as WMS dev lays it out ----------

/** The MRN (Oracle inbound shipment) fields every PIB GR screen shows. */
export interface PibShipmentFields {
  erp_doc_id: string | null;
  /** Nomor Aju: the customs registration number (Oracle custrecord_msi_aju_no). */
  aju_number: string | null;
  expected_shipping_date: string | null;
  actual_shipping_date: string | null;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  vessel_number: string | null;
  bill_of_lading: string | null;
  port: string | null;
}

export interface PibGrRow extends PibShipmentFields {
  id: string;
  status: string;
  mrn_id: string;
  transaction_id: string | null;
  gr_number: string;
  ownership: string | null;
  warehouse: string | null;
  item_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** With include_items: the GR's lines for the list's accordion. */
  items?: TransferGrListLine[];
}

export type PibGrFilterField =
  | 'material_code'
  | 'aju_number'
  | 'warehouse'
  | 'created_at'
  | 'vessel_number'
  | 'material_name'
  | 'bill_of_lading'
  | 'transaction_id'
  | 'erp_doc_id';

export interface PibGrFilter {
  field: PibGrFilterField;
  values: string[];
}

/** A PIB GR line: an MRN item with its PO and supplier. */
export interface PibGrItem extends TransferGrItem {
  po_number: string | null;
  erp_po_id: number | null;
  supplier: string | null;
}

export interface PibGrDetail extends Omit<PibGrRow, 'warehouse' | 'item_count' | 'items'> {
  warehouse: { id: string; name: string } | null;
  can_receive: boolean;
  items: PibGrItem[];
}

export interface PibPutawayRow extends TransferPutawayRow {
  aju_number: string | null;
}

export interface PibPutawayItem extends TransferPutawayItem {
  po_number: string | null;
  erp_po_id: number | null;
}

export interface PibPutawayDetail extends Omit<PibPutawayRow, 'warehouse' | 'destination_location'> {
  warehouse: { id: string; name: string } | null;
  can_putaway: boolean;
  items: PibPutawayItem[];
}

export interface PibHistoryRow {
  id: string;
  transaction_id: string | null;
  aju_number: string | null;
  po_number: string | null;
  gr_number: string | null;
  putaway_code: string;
  material_code: string | null;
  material_name: string | null;
  material_type: string | null;
  material_category: string | null;
  request_qty: number;
  receive_qty: number;
  warehouse: string | null;
  destination_bin: string | null;
  supplier: string | null;
  ownership: string | null;
  created_by: string | null;
  created_at: string;
}
