# PRD 03 — Material Management

## 1. Overview

Material Management maintains the catalog of materials and their classification
masters (categories, types, units of measure). Materials originate in the Oracle
ERP and are imported via sync; certain fields can then be enriched in WMS.

## 2. Objectives

- Mirror ERP materials into WMS, keyed by the ERP document id.
- Let staff classify/enrich materials (category, type, UOMs, dimensions) without
  overwriting ERP-owned identity fields.
- Maintain supporting masters (categories, types, UOM).

## 3. Data model

### Material (`materials`)

| Field | Type | Notes |
| ----- | ---- | ----- |
| `id` | uuid (PK) | |
| `erpDocId` | string (unique, nullable) | Oracle `internalId`; null for local records. |
| `materialName` | string | ERP `displayName` (may be empty). |
| `materialCode` | string (unique) | ERP `itemId`. |
| `conversionRateQuantity`, `currency` | number / string? | |
| `materialLength/Width/Height/Weight/Qty` | number | Default 0. |
| `materialCategoryId` / `materialTypeId` | uuid? (FK) | Optional (ERP items may lack them). |
| `primaryUomId` / `secondaryUomId` / `weightUomId` / `dimensionUomId` | uuid? (FK → uoms) | Optional slots. |
| `photos` | string[] | |
| `isActive`, `createdBy`, `modifiedBy`, `createdAt`, `updatedAt` | | |

### Masters

- **Material Category** (`material_categories`): `materialCategoryName`, `materialCategoryCode` (unique), `description`, `isActive`.
- **Material Type** (`material_types`): `materialTypeName`, `materialTypeCode` (unique), `description`, `isActive`.
- **UOM** (`uoms`): `uomName`, `uomCode` (unique), `isActive`.

## 4. ERP (Oracle) integration

- **Auth:** `POST /auth/token` with `client_credentials` → Bearer access token.
- **Items:** `POST /items/get` with `{ page, page_size, sort_by: "lastmodifieddate", sort_order: "DESC", filters }`.
- **Field mapping:**

  | WMS | Oracle |
  | --- | ------ |
  | `erp_doc_id` | `internalId` |
  | `material_code` | `itemId` |
  | `material_name` | `displayName` (kept as-is, may be empty) |

- **Loop:** page through up to **200 records/page**, **1.5s delay** between pages,
  until the last page; **upsert by `erp_doc_id`** (falls back to `material_code`
  to reconcile pre-existing rows).
- **Window:** the sync uses the most recent synced `created_at` as `filters.lastmodified`
  automatically (no manual date entry); empty = full sync.
- **Triggers:** `POST /api/materials/sync-erp` (UI button, `materials:sync`) and CLI
  `npm run sync:erp [-- <ISO datetime>]`.

## 5. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| GET | `/api/materials` | `materials:read` | Paginated list (`page,limit,search,order_by`). |
| GET | `/api/materials/:id` | `materials:read` | Get one (serialized snake_case). |
| GET | `/api/materials/erp-last-sync` | `materials:read` | Last sync timestamp. |
| PUT | `/api/materials/:id` | `materials:update` | Edit (ERP fields locked for ERP items). |
| POST | `/api/materials/sync-erp` | `materials:sync` | Run ERP sync. |
| CRUD | `/api/material-categories` | `material-categories:*` | + `/options`. |
| CRUD | `/api/material-types` | `material-types:*` | + `/options`. |
| CRUD | `/api/uoms` | `uoms:*` | + `/options`. |

Materials have **no create/delete** in WMS (ERP-owned). Lists/details are serialized
in the original snake_case shape with nested `material_category`, `material_type`,
the four UOM slots, and `erp_doc_id`.

## 6. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| MAT-1 | Import all ERP items via full sync; incremental sync by last sync time. | ✅ |
| MAT-2 | Sync is idempotent (upsert by `erp_doc_id`). | ✅ |
| MAT-3 | Material list is paginated and searchable by code/name. | ✅ |
| MAT-4 | No create/delete for materials in WMS. | ✅ |
| MAT-5 | For ERP materials, `material_code` & `material_name` are read-only; other fields editable. | ✅ |
| MAT-6 | Edit is a dedicated page; users without `materials:update` see a read-only view. | ✅ |
| MAT-7 | Categories, types, UOM support full CRUD. | ✅ |
| MAT-8 | Master in use by a material cannot be deleted. | ✅ |

## 7. Business rules

- `erp_doc_id`, `material_code`, `material_name` are owned by Oracle for synced rows.
- Per-row sync failures are logged and counted; the run continues.
- UOM/category/type referenced by a material cannot be deleted.

## 8. Acceptance criteria

- Running `npm run sync:erp` populates materials and reports counts.
- Editing an ERP material's category persists; editing its code is blocked.
- A 9k+ item full sync completes within a few minutes with the page delay applied.
