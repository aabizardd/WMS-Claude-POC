# PRD 00 — Product Overview

## 1. Vision

WMS is an internal warehouse management system that mirrors master data from the
company's Oracle/NetSuite ERP (via an API bridge) and lets warehouse staff manage
warehouse structure (warehouses, aisles, shelves, bins) and material information.
Access is controlled by a role-based permission system.

## 2. Goals & objectives

- Provide a single, authenticated admin console for warehouse master data.
- Keep **materials** and **warehouses** in sync with the ERP as the source of truth.
- Let teams manage local warehouse structure (area types, aisles, shelves, bins).
- Enforce least-privilege access through roles and granular permissions.

## 3. Personas

| Persona | Description | Typical access |
| ------- | ----------- | -------------- |
| **Administrator** | System owner; manages users, roles, and all data. | Superuser (all permissions). |
| **Warehouse staff** | Day-to-day operator. | Read master data; manage bins where granted. |
| **Data steward** | Maintains material/warehouse structure. | CRUD on assigned modules + ERP sync. |

## 4. High-level architecture

```
+-------------------+        HTTPS/JWT        +----------------------+
|   Frontend (SPA)  | <---------------------> |   Backend (REST API) |
|  React + Vite + TS|                         |   NestJS + Prisma    |
|  TailwindCSS      |                         |                      |
+-------------------+                         +----------+-----------+
                                                         |
                                              Prisma ORM |
                                                         v
                                              +----------------------+
                                              |   PostgreSQL         |
                                              +----------------------+
                                                         ^
                              client_credentials + Bearer|  (server-to-server)
                                                         |
                                              +----------------------+
                                              | Oracle ERP API bridge|
                                              | items/get, locations |
                                              +----------------------+
```

## 5. Tech stack

| Layer | Choice |
| ----- | ------ |
| Frontend | React 18, TypeScript, Vite, React Router, TailwindCSS (Poppins global font), Axios |
| Backend | NestJS 10, Prisma 5, class-validator |
| Database | PostgreSQL |
| Auth | JWT access token (permissions embedded in token) |
| Integration | Oracle ERP API bridge (OAuth2 client_credentials → Bearer) |

## 6. Repository structure

```
C:\WMS
├─ backend/    NestJS API (auth, RBAC, materials, warehouses, bins, sync)
├─ frontend/   React admin UI
└─ docs/prd/   These documents
```

## 7. Cross-cutting requirements

- **AuthN:** every API route requires a valid JWT except `POST /auth/login`.
- **AuthZ:** routes opt into permissions via `@RequirePermissions(...)`; `admin`
  role bypasses checks (superuser).
- **Validation:** all request bodies validated with DTOs (`whitelist`, `forbidNonWhitelisted`).
- **Passwords:** hashed with bcrypt; never returned by the API.
- **Pagination:** list endpoints return `{ total_page, total_data, attributes, rows }`.
- **ERP sync:** paged (max 200/page), 1.5s delay between pages, upsert by external id.
- **Lookup endpoints:** `/<resource>/options` return minimal data for dropdowns and
  require only authentication (no resource-specific read permission).
- **Warehouse data scoping:** records that carry a `warehouseId` (currently **bins**
  and **users**) are filtered to the logged-in user's warehouse. The `admin` role
  bypasses the filter and sees all warehouses. The user's `warehouseId` is embedded
  in the JWT.

## 8. Non-functional requirements

| Area | Requirement |
| ---- | ----------- |
| Security | JWT signed with server secret; CORS limited to the configured frontend origin. |
| Performance | Sync of ~10k records completes within minutes; list endpoints paginated. |
| Reliability | Sync upserts are idempotent; per-row failures are logged and counted, not fatal. |
| Usability | Responsive admin layout; menus and actions reflect the user's permissions. |

## 9. Out of scope (current release)

- Inventory quantities / stock movements / putaway & picking workflows.
- Multi-role per user (one role per user today).
- Refresh tokens / SSO.
