# PRD 08 — Inventory Management

## 1. Overview

Inventory Management records goods that were successfully received into a warehouse.
It is **generated automatically** when a Goods Receive is confirmed/received by the
ERP — there is no manual create/update. One row per material per warehouse; each
receive adds a **batch**.

## 2. Generation trigger & rules

- **Trigger:** when a Goods Receive's ERP receive succeeds (status → `On Progress`),
  the inbound flow calls `InventoryService.generateFromGoodsReceive(grId)`.
- For each received MRN item (`qty_actual > 0`):
  - Resolve the material: `mrn_item.item_id` → `materials.erp_doc_id`.
  - Find-or-create the inventory row keyed by **(material_code, warehouse)**.
  - Add a **batch**: `avail_qty = qty_actual` (others 0), `bin_location` from the GR
    item's bin destination, `gr_number` from the GR, `company_name` from the vendor
    master (`vendor.oracle_id = mrn_item.vendor_id`).
- **Idempotent:** one batch per MRN item (`inventory_batches.mrn_item_id` is unique),
  so retries don't duplicate.

## 3. Data model

### InventoryManagement (`inventory_management`)
`materialCode`, `materialId` (FK → materials, for name/type/category/UoM),
`warehouseId`. Unique on (`materialCode`, `warehouseId`).

### InventoryBatch (`inventory_batches`)
`inventoryId`, `reservedQty`, `availQty`, `inTransitQty`, `qualityIssue`, `qtyIssue`,
`binId` (FK → bins), `goodsReceiveId` (FK → goods_receives), `mrnItemId`
(unique FK → mrn_items), `vendorCompanyName`.

### Quantity formula
`on_hand = reserved_qty + avail_qty + quality_issue + qty_issue`
(`in_transit_qty` is tracked separately and not part of on_hand).

## 4. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| GET | `/api/inventory` | `inventory:read` | Paginated list; quantities = **sum of batches**. |
| GET | `/api/inventory/:id` | `inventory:read` | Detail: header + per-batch list. |

**List** shows: material_name, material_code, material_type, material_category,
primary_uom, warehouse_name, and summed on_hand/reserved/avail/in_transit/quality_issue/qty_issue.

**Detail** shows the same header plus a **batch list**, each with: on_hand, reserved,
avail, in_transit, quality_issue, qty_issue, warehouse_name, **bin_location**,
**GR_number**, **company_name** (vendor).

## 5. Scoping & permissions

- Scoped by warehouse (admin sees all); permission `inventory:read` (no CUD).

## 6. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| INV-1 | Inventory generated when GR is received (status On Progress). | ✅ |
| INV-2 | One inventory row per material code per warehouse; each receive adds a batch. | ✅ |
| INV-3 | Material name/code/type/category/UoM joined from materials via item_id→erp_doc_id. | ✅ |
| INV-4 | List quantities are the sum of batches; on_hand uses the formula. | ✅ |
| INV-5 | Detail shows batches with bin location, GR number, vendor company name. | ✅ |
| INV-6 | Generation is idempotent (one batch per MRN item). | ✅ |
| INV-7 | No manual create/update/delete. | ✅ |

## 7. Acceptance criteria

- Receiving a GR creates/updates inventory rows and one batch per received item.
- Re-running the receive does not create duplicate batches.
- The list sums match the detail batches; on_hand follows the formula.
