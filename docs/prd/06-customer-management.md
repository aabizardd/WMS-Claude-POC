# PRD 06 — Customer Management

## 1. Overview

Customer Management maintains a **read-only mirror** of customers from the Oracle
ERP `customers/get` endpoint. Customers are never created or edited in WMS; they are
kept current via full and incremental sync, exactly like vendors and warehouses.

## 2. Objectives

- Mirror Oracle customers into WMS, keyed by the Oracle `internalId`.
- Provide an initial full inject and ongoing incremental sync by last-modified time.
- Expose customers for viewing and as a lookup for future modules.

## 3. Data model

### Customer (`customers`) — read-only mirror

| Field | Oracle source |
| ----- | ------------- |
| `oracleId` (unique) | `internalId` |
| `entityId` | `entityId` |
| `companyName` | `companyName` |
| `email` | `email` |
| `phone` | `phone` |
| `lastModified` | `last_modified` (may be empty → stored as null) |
| `createdBy`, `createdAt`, `updatedAt` | (WMS-managed) |

## 4. Oracle (customers) integration

- **Endpoint:** `POST /customers/get` with `{ page, page_size, sort_by: "lastModifiedDate", sort_order: "DESC", filters }`, Bearer token from `/auth/token`.
  - Note: customers use `sort_by: "lastModifiedDate"` (camelCase), unlike other
    feeds which use `lastmodifieddate`.
- **Mapping:** all response fields → customer columns (see table above).
- **Loop:** up to **200/page**, **1.5s delay** between pages, until the last page;
  **upsert by `oracle_id`**.
- **Window:** automatic from the latest synced `created_at`; empty = full sync.
- **Triggers:** `POST /api/customers/sync-erp` (UI button, `customers:sync`) and CLI
  `npm run sync:customers [-- <ISO datetime>]`.

## 5. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| GET | `/api/customers` | `customers:read` | Paginated list (`page,limit,search,order_by`). |
| GET | `/api/customers/options` | auth | Lookup (id, company, entity). |
| GET | `/api/customers/erp-last-sync` | `customers:read` | Last sync timestamp. |
| POST | `/api/customers/sync-erp` | `customers:sync` | Run Oracle sync. |

Customers are **read-only** (no create/update/delete; sync only). Searchable by
company name, entity id, and email.

## 6. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| CUS-1 | Sync all Oracle customers via full sync; incremental by last sync time. | ✅ |
| CUS-2 | Sync is idempotent (upsert by `oracle_id`). | ✅ |
| CUS-3 | Customer list paginated/searchable; read-only (no CRUD). | ✅ |
| CUS-4 | Initial inject via CLI `npm run sync:customers` and UI button. | ✅ |
| CUS-5 | Empty `last_modified` values are stored as null (not invalid dates). | ✅ |

## 7. Business rules

- Customer identity (`oracle_id`) is owned by Oracle; never edited in WMS.
- Per-row sync failures are logged and counted; the run continues.

## 8. Acceptance criteria

- `npm run sync:customers` populates customers and reports counts (e.g. 244 records).
- Re-running the sync does not create duplicates.
- A user with only `customers:read` can view the list but sees no Sync button.
