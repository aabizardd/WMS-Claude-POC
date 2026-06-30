# PRD 04 — Warehouse Management

## 1. Overview

Warehouse Management covers the physical warehouse structure: **warehouses**
(mirrored from the Oracle "locations" endpoint, read-only), and the locally
managed masters **area types**, **aisles**, **shelves**, and **bins**. Bins are
the addressable storage locations and reference all of the above.

## 2. Objectives

- Mirror Oracle locations into a WMS warehouse table (source of truth = ERP).
- Let staff define warehouse structure (area types, aisles, shelves).
- Manage bins (CRUD) that tie structure + a warehouse + a dimension UOM together.

## 3. Data model

### Warehouse (`warehouses`) — read-only mirror

| Field | Oracle source |
| ----- | ------------- |
| `oracleId` (unique) | `id` |
| `name` | `name` |
| `isInactive` | `is_inactive` |
| `parentId` / `parentName` | `parent_id` / `parent_name` |
| `subsidiaryId` / `subsidiaryName` | `subsidiary_id` / `subsidiary_name` |
| `locationType` / `locationTypeName` | `location_type` / `location_type_name` |
| `timezone` | `timezone` |
| `makeInventoryAvailable` | `make_inventory_available` |
| `lastModified` | `last_modified` |
| `createdBy`, `createdAt`, `updatedAt` | (WMS-managed) |

### Masters

- **Area Type** (`area_types`): `areaTypeName`, `areaTypeCode` (unique), `isActive`.
- **Aisle** (`aisles`): `aisleName`, `aisleCode` (unique), `isActive`.
- **Shelf** (`shelves`): `shelfLabel`, `shelfCode` (unique), `isActive`.

### Bin (`bins`)

| Field | Type | Notes |
| ----- | ---- | ----- |
| `id` | uuid (PK) | |
| `binLabel` | string | |
| `binCode` | string (unique) | |
| `binLength/Width/Height`, `maxCapacity` | number | Default 0. |
| `warehouseId` (FK), `aisleId` (FK), `shelfId` (FK), `areaTypeId` (FK) | uuid | Required. |
| `dimensionUomId` | uuid? (FK → uoms) | Optional. |
| `isActive`, `createdBy`, `modifiedBy`, `createdAt`, `modifiedAt` | | `modifiedAt` null until edited. |

Bin list/detail are serialized to match the reference API shape with nested
`shelf`, `aisle`, `warehouse_name`, `warehouse_area_type`, and `dimension_uom`.

> **Decision:** Oracle locations have no warehouse code, so the bin's
> `warehouse_name.warehouse_code` is populated with the warehouse `oracle_id`.
> Revisit if an authoritative warehouse code source becomes available.

## 4. Oracle (locations) integration

- **Endpoint:** `POST /locations/get` with `{ page, page_size, sort_by: "lastmodifieddate", sort_order: "DESC", filters }`, Bearer token from `/auth/token`.
- **Mapping:** all response fields → warehouse columns (see table above).
- **Loop:** up to **200/page**, **1.5s delay** between pages, until the last page;
  **upsert by `oracle_id`**.
- **Window:** automatic from the latest synced `created_at`; empty = full sync.
- **Triggers:** `POST /api/warehouses/sync-erp` (UI button, `warehouses:sync`) and
  CLI `npm run sync:warehouses [-- <ISO datetime>]`.

## 5. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| GET | `/api/warehouses` | `warehouses:read` | Paginated list. |
| GET | `/api/warehouses/options` | auth | Lookup (id, name). |
| GET | `/api/warehouses/erp-last-sync` | `warehouses:read` | Last sync timestamp. |
| POST | `/api/warehouses/sync-erp` | `warehouses:sync` | Run Oracle sync. |
| CRUD | `/api/area-types` | `area-types:*` | + `/options`. |
| CRUD | `/api/aisles` | `aisles:*` | + `/options`. |
| CRUD | `/api/shelves` | `shelves:*` | + `/options`. |
| GET | `/api/bins` | `bins:read` | Paginated list (`page,limit,search,order_by`). |
| GET | `/api/bins/:id` | `bins:read` | Get one (serialized). |
| POST | `/api/bins` | `bins:create` | Create bin. |
| PUT | `/api/bins/:id` | `bins:update` | Update bin. |
| DELETE | `/api/bins/:id` | `bins:delete` | Delete bin. |

Warehouses are **read-only** (no create/update/delete; sync only).

## 6. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| WH-1 | Sync all Oracle locations into warehouses; incremental by last sync time. | ✅ |
| WH-2 | Warehouse list paginated/searchable; read-only (no CRUD). | ✅ |
| WH-3 | Area types, aisles, shelves support full CRUD. | ✅ |
| WH-4 | Master in use by a bin cannot be deleted. | ✅ |
| BIN-1 | Bins support full CRUD with relation dropdowns (warehouse, area type, aisle, shelf, dimension UOM). | ✅ |
| BIN-2 | Bin list paginated/searchable by label/code; default order `bin_label desc`. | ✅ |
| BIN-3 | Bin responses match the reference snake_case shape with nested relations. | ✅ |
| BIN-4 | Bin edit is a dedicated page; users without `bins:update` get a read-only view. | ✅ |
| BIN-5 | Non-admins only see/open bins in their own warehouse; admin sees all. | ✅ |

## 7. Business rules

- Warehouse identity (`oracle_id`) is owned by Oracle; never edited in WMS.
- A bin requires a warehouse, area type, aisle, and shelf; dimension UOM is optional.
- Area type / aisle / shelf referenced by a bin cannot be deleted.
- Per-row sync failures are logged and counted; the run continues.

## 8. Acceptance criteria

- `npm run sync:warehouses` populates warehouses and reports counts.
- Creating a bin with valid relations returns the nested serialized object.
- Deleting an aisle that a bin references is blocked with a clear message.
