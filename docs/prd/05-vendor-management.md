# PRD 05 — Vendor Management

## 1. Overview

Vendor Management maintains a **read-only mirror** of vendors from the Oracle ERP
`vendors/get` endpoint. Vendors are never created or edited in WMS; they are kept
current via full and incremental sync, exactly like warehouses.

## 2. Objectives

- Mirror Oracle vendors into WMS, keyed by the Oracle `internalId`.
- Provide an initial full inject and ongoing incremental sync by last-modified time.
- Expose vendors for viewing and as a lookup for future modules.

## 3. Data model

### Vendor (`vendors`) — read-only mirror

| Field | Oracle source |
| ----- | ------------- |
| `oracleId` (unique) | `internalId` |
| `entityId` | `entityId` |
| `companyName` | `companyName` |
| `email` | `email` |
| `phone` | `phone` |
| `terms` | `terms` |
| `termsDisplay` | `terms_display` |
| `subsidiaryId` | `subsidiary` |
| `subsidiaryDisplay` | `subsidiary_display` |
| `lastModified` | `last_modified` |
| `createdBy`, `createdAt`, `updatedAt` | (WMS-managed) |

## 4. Oracle (vendors) integration

- **Endpoint:** `POST /vendors/get` with `{ page, page_size, sort_by: "lastmodifieddate", sort_order: "DESC", filters }`, Bearer token from `/auth/token`.
- **Mapping:** all response fields → vendor columns (see table above).
- **Loop:** up to **200/page**, **1.5s delay** between pages, until the last page;
  **upsert by `oracle_id`**.
- **Window:** automatic from the latest synced `created_at`; empty = full sync.
- **Triggers:** `POST /api/vendors/sync-erp` (UI button, `vendors:sync`) and CLI
  `npm run sync:vendors [-- <ISO datetime>]`.

## 5. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| GET | `/api/vendors` | `vendors:read` | Paginated list (`page,limit,search,order_by`). |
| GET | `/api/vendors/options` | auth | Lookup (id, company, entity). |
| GET | `/api/vendors/erp-last-sync` | `vendors:read` | Last sync timestamp. |
| POST | `/api/vendors/sync-erp` | `vendors:sync` | Run Oracle sync. |

Vendors are **read-only** (no create/update/delete; sync only). Searchable by
company name, entity id, and email.

## 6. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| VEN-1 | Sync all Oracle vendors via full sync; incremental by last sync time. | ✅ |
| VEN-2 | Sync is idempotent (upsert by `oracle_id`). | ✅ |
| VEN-3 | Vendor list paginated/searchable; read-only (no CRUD). | ✅ |
| VEN-4 | Initial inject via CLI `npm run sync:vendors` and UI button. | ✅ |
| VEN-5 | Sync button uses the last sync time automatically (no manual date entry). | ✅ |

## 7. Business rules

- Vendor identity (`oracle_id`) is owned by Oracle; never edited in WMS.
- Per-row sync failures are logged and counted; the run continues.

## 8. Acceptance criteria

- `npm run sync:vendors` populates vendors and reports counts (e.g. 476 records).
- Re-running the sync does not create duplicates.
- A user with only `vendors:read` can view the list but sees no Sync button.
