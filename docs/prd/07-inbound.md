# PRD 07 — Inbound (MRN, Goods Receive)

## 1. Overview

The Inbound process moves goods into the warehouse through stages:
**MRN → Goods Receive → Putaway → History**. The UI is a single **Inbound** page
with one tab per stage. This release implements **MRN** and **Goods Receive**;
Putaway and History are placeholders.

## 2. Stage flow

1. **MRN** mirrors Oracle **PIB** (inbound shipments) with status `inTransit`.
   Each synced PIB becomes an MRN with WMS status **Closed** and auto-creates a
   **Goods Receive** document with status **Open**.
2. **Goods Receive** is where the operator enters the **actual received quantity**
   per item. (Completion/status transition rules to be defined in a later step.)

## 3. Data model

### Mrn (`mrns`) — Oracle PIB header, read-only

Header fields mirror the PIB (`oracleId` = PIB `id`, `shipmentNumber`, dates, memo,
vessel, bill of lading, port, `oracleStatus`, …). WMS-owned: `status` = `Closed`,
`warehouseId` (resolved from the items' `receiving_location_id` → Warehouse
`oracleId`) for scoping.

### MrnItem (`mrn_items`) — PIB line items

`po_id`, `item_id`, `line_id`, `po_rate`, `item_name`, `po_number`, `vendor_id/name`,
`qty_expected`, `qty_received` (Oracle), `qty_remaining`, `shipment_item_amount`,
`receiving_location_id/name`, plus **`qty_actual`** (WMS-entered in Goods Receive).
Unique on (`mrnId`, `lineId`) so re-sync preserves `qty_actual`.

### GoodsReceive (`goods_receives`)

`mrnId` (1:1), `grNumber` (`GR-<shipmentNumber>`), `status` (default `Open`),
`warehouseId`.

## 4. Oracle (PIB) integration

- **Endpoint:** `POST /inbound-shipments/get`, body
  `{ page, page_size, sort_by: "lastmodifieddate", sort_order: "desc", filters: { status: "inTransit" } }`,
  Bearer token from `/auth/token`.
- **Loop:** up to **200/page**, **1.5s delay**, until the last page;
  **upsert MRN by `oracle_id`**; items upserted by (`mrnId`,`lineId`) preserving
  `qty_actual`; a Goods Receive doc is created once per MRN.
- **Triggers:** `POST /api/mrn/sync-erp` (UI button, `mrn:sync`) and CLI
  `npm run sync:mrn [-- <ISO datetime>]`. No create/update/delete on MRN.

## 5. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| POST | `/api/mrn/sync-erp` | `mrn:sync` | Sync PIB (inTransit) into MRN. |
| GET | `/api/mrn` | `mrn:read` | Paginated MRN list. |
| GET | `/api/mrn/:id` | `mrn:read` | MRN detail (header + items). |
| GET | `/api/mrn/erp-last-sync` | `mrn:read` | Last sync timestamp. |
| GET | `/api/goods-receive` | `goods-receive:read` | Paginated GR list. |
| GET | `/api/goods-receive/:id` | `goods-receive:read` | GR detail (filtered fields). |
| PUT | `/api/goods-receive/:id/actuals` | `goods-receive:update` | Save actual quantities. |

**Goods Receive display rule:** hides `qty_remaining`, `shipment_item_amount`, and
all `*_id` fields — only names are shown (item, PO number, vendor, receiving
location) plus `qty_expected` and the editable `qty_actual`.

## 6. Scoping & permissions

- MRN and Goods Receive are **scoped by warehouse** (resolved receiving location).
  Non-admins only see their warehouse's documents; `admin` sees all.
- Permissions: `mrn:read`, `mrn:sync`, `goods-receive:read`, `goods-receive:update`.

## 7. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| INB-1 | Inbound page with tabs MRN / Goods Receive / Putaway / History. | ✅ (Putaway & History placeholders) |
| MRN-1 | Sync PIB with status `inTransit` (full + incremental); read-only. | ✅ |
| MRN-2 | Synced MRN gets WMS status `Closed` and auto-creates a GR (status `Open`). | ✅ |
| MRN-3 | Re-sync preserves entered actual quantities. | ✅ |
| GR-1 | GR list shows documents with status; opens a page to enter actuals. | ✅ |
| GR-2 | GR detail hides qty remaining, shipment amount, and ids; shows names only. | ✅ |
| GR-3 | Operator saves actual received quantity per item. | ✅ |
| GR-4 | Completion/status transition after actuals. | 🔜 (to be defined) |

## 8. Acceptance criteria

- `npm run sync:mrn` (or the UI button) pulls inTransit PIBs; each creates an MRN
  (Closed) and a GR (Open); the run reports counts.
- Opening a GR shows the allowed columns and lets the user save actual quantities;
  re-syncing does not wipe them.
