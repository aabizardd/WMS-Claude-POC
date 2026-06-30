# WMS — Warehouse Management System

Auth + master data (Users & Roles) starter, full-stack.

- **Frontend:** React + TypeScript + Vite + Tailwind (Poppins global font)
- **Backend:** NestJS + Prisma + PostgreSQL, JWT auth
- **Features:** login, JWT-protected admin area, User CRUD, Role CRUD (master data)

## Structure

```
C:\WMS
├─ backend/    NestJS API (auth, users, roles)
└─ frontend/   React admin UI (login + admin template)
```

## Prerequisites

- Node.js 18+
- A running PostgreSQL instance

## 1. Backend setup

```bash
cd backend
npm install

# configure DB connection in .env (DATABASE_URL) if different from default
npm run prisma:generate
npm run prisma:migrate -- --name init   # creates tables
npm run prisma:seed                      # seeds roles + default admin

npm run start:dev                        # http://localhost:3000/api
```

Default login created by the seed:

- **username:** `admin`
- **password:** `admin123`

## 2. Frontend setup

```bash
cd frontend
npm install
npm run dev                              # http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so no extra config is needed.

## API overview

| Method | Endpoint           | Access | Description              |
| ------ | ------------------ | ------ | ------------------------ |
| POST   | `/api/auth/login`  | public | Login, returns JWT       |
| GET    | `/api/auth/me`     | auth   | Current user             |
| GET    | `/api/users`       | admin  | List users               |
| POST   | `/api/users`       | admin  | Create user              |
| PUT    | `/api/users/:id`   | admin  | Update user              |
| DELETE | `/api/users/:id`   | admin  | Delete user              |
| GET    | `/api/roles`       | admin  | List roles (master data) |
| POST   | `/api/roles`       | admin  | Create role              |
| PUT    | `/api/roles/:id`   | admin  | Update role              |
| DELETE | `/api/roles/:id`   | admin  | Delete role              |

### Material Management (authenticated)

| Method | Endpoint                       | Description                          |
| ------ | ------------------------------ | ------------------------------------ |
| GET    | `/api/materials`               | List materials (paginated + search)  |
| POST   | `/api/materials`               | Create material                      |
| PUT    | `/api/materials/:id`           | Update material                      |
| DELETE | `/api/materials/:id`           | Delete material                      |
| CRUD   | `/api/material-categories`     | Material categories master           |
| CRUD   | `/api/material-types`          | Material types master                |
| CRUD   | `/api/uoms`                    | Units of measure master              |

`GET /api/materials` supports `?page=&limit=&search=&order_by=` and returns the
shape `{ total_page, total_data, attributes, rows }`. Material rows are serialized
in the original snake_case API format (with nested `material_category`,
`material_type`, the four UOM slots, and `erp_doc_id`).

### ERP / Oracle sync

Materials can be imported from the Oracle bridge. Mapping:

| WMS            | Oracle       |
| -------------- | ------------ |
| `erp_doc_id`   | `internalId` |
| `material_code`| `itemId`     |
| `material_name`| `displayName`|

Configure `ERP_BASE_URL`, `ERP_CLIENT_ID`, `ERP_CLIENT_SECRET` in `backend/.env`.
The sync obtains a bearer token (`/auth/token`), then pages through `/items/get`
(200 per page, `sort_by=lastmodifieddate desc`) until the last page, upserting
each item by `erp_doc_id`.

**Initial full inject (CLI):**

```bash
cd backend
npm run sync:erp                              # full sync of all items
npm run sync:erp -- 2024-06-25T09:04:00+07:00 # incremental since a date
```

**From the UI (admin):** open *Material Info → Sync from ERP*. Leave the date
empty for a full sync, or pick a "modified since" date for an incremental sync
(sent as `filters.lastmodified`). Endpoint: `POST /api/materials/sync-erp`
with body `{ "lastModified"?: ISO-datetime, "pageSize"?: number }`.

Passwords are hashed with bcrypt and never returned by the API.

## RBAC (Role-Based Access Control)

Tables: `permissions` (catalog) and `role_permissions` (role ↔ permission join).
A user has one role; a role has many permissions.

- **Permission keys** are `resource:action`, e.g. `users:create`, `materials:sync`.
  The catalog lives in [permissions.catalog.ts](backend/src/auth/permissions.catalog.ts)
  and is seeded into the DB.
- **Backend enforcement:** permissions are embedded in the JWT at login. A global
  `PermissionsGuard` checks `@RequirePermissions('…')` on each route. The `admin`
  role is a superuser and bypasses all checks.
- **Frontend:** `useAuth().has('key')` gates sidebar menus, routes
  (`RequirePermission`), and every Add/Edit/Delete/Sync button. `admin` sees all.
- Manage a role's permissions in **Roles → Edit** (a module × action matrix down to
  CRUD + sync).

> Permissions are embedded in the JWT, so changes to a role's permissions take
> effect for a user **after they log in again**.

Seeded roles: `admin` (all permissions) and `staff` (read-only baseline).

## Warehouse Management

Tables: `warehouses` (synced from Oracle, read-only), `area_types`, `aisles`,
`shelves` (manual masters), and `bins` (manual CRUD, references all of the above
+ a dimension UOM).

### Warehouse (Oracle locations) sync

Warehouses mirror the Oracle `locations/get` endpoint. All response fields become
columns (`oracle_id`, `name`, `is_inactive`, `parent_*`, `subsidiary_*`,
`location_type*`, `timezone`, `make_inventory_available`, `last_modified`). The
sync pages through 200 per request, 1.5s between pages, upserting by `oracle_id`.

```bash
cd backend
npm run sync:warehouses                                # full sync
npm run sync:warehouses -- 2026-04-06T00:00:00+07:00   # incremental
```

From the UI (admin): *Warehouse Management → Warehouses → Sync from ERP*.
Endpoint: `POST /api/warehouses/sync-erp`. The sync window is taken automatically
from the last synced `created_at`.

Bins are returned in the reference snake_case shape with nested `shelf`, `aisle`,
`warehouse_name`, `warehouse_area_type`, and `dimension_uom`.

## Vendor Management

`vendors` is a read-only mirror of the Oracle `vendors/get` endpoint. All response
fields become columns (`oracle_id`, `entity_id`, `company_name`, `email`, `phone`,
`terms`, `terms_display`, `subsidiary`, `subsidiary_display`, `last_modified`). The
sync pages through 200 per request, 1.5s between pages, upserting by `oracle_id`.

```bash
cd backend
npm run sync:vendors                                # full sync
npm run sync:vendors -- 2026-06-18T18:20:00+07:00   # incremental
```

From the UI (admin): *Vendors → Sync from ERP*. Endpoint: `POST /api/vendors/sync-erp`.
The sync window is taken automatically from the last synced `created_at`.

## Customer Management

`customers` is a read-only mirror of the Oracle `customers/get` endpoint
(`oracle_id`, `entity_id`, `company_name`, `email`, `phone`, `last_modified`).
Same paging/upsert behaviour; uses `sort_by: "lastModifiedDate"`.

```bash
cd backend
npm run sync:customers                                # full sync
npm run sync:customers -- 2026-06-18T18:20:00+07:00   # incremental
```

From the UI (admin): *Customers → Sync from ERP*. Endpoint: `POST /api/customers/sync-erp`.
