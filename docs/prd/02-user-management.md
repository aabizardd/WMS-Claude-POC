# PRD 02 — User Management

## 1. Overview

Administrators manage application users and assign each user a single role, which
determines their permissions (see [PRD 01](01-auth-and-rbac.md)).

## 2. Objectives

- Maintain the list of people who can sign in.
- Control access by assigning a role per user.
- Keep credentials secure (hashed, never exposed).

## 3. Data model

| Field | Type | Notes |
| ----- | ---- | ----- |
| `id` | int (PK) | Auto-increment. |
| `firstName` | string? | |
| `lastName` | string? | |
| `name` | string | Display name, **derived** from `firstName` + `lastName`. |
| `email` | string (unique) | |
| `username` | string (unique) | Login id. |
| `password` | string | bcrypt hash; never returned. |
| `isActive` | boolean | Inactive users cannot log in. |
| `roleId` | int (FK → roles) | One role per user. |
| `warehouseId` | uuid? (FK → warehouses) | Required single warehouse on create/edit (column nullable for legacy rows). |
| `createdAt` / `updatedAt` | datetime | |

## 4. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| GET | `/api/users` | `users:read` | List users (with role). |
| GET | `/api/users/:id` | `users:read` | Get one user. |
| POST | `/api/users` | `users:create` | Create user. |
| PUT | `/api/users/:id` | `users:update` | Update user; password optional. |
| DELETE | `/api/users/:id` | `users:delete` | Delete user. |

The role dropdown is populated from `/api/roles/options` (auth-only lookup).

## 5. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| USR-1 | Admin lists users with name, username, email, role, warehouse, status. | ✅ |
| USR-2 | Admin creates a user with first/last name, role, **required** warehouse, and password (min 6 chars). | ✅ |
| USR-3 | On edit, leaving the password blank keeps the existing one. | ✅ |
| USR-4 | Email and username must be unique (clear error otherwise). | ✅ |
| USR-5 | Users can be activated/deactivated via `isActive`. | ✅ |
| USR-6 | Action buttons appear only with the matching permission. | ✅ |
| USR-7 | Create/edit are dedicated pages (not modals). | ✅ |
| USR-8 | `name` is derived from `firstName` + `lastName`. | ✅ |
| USR-9 | Warehouse is selectable from the warehouse master (required, via `/warehouses/options`). | ✅ |
| USR-10 | Non-admins only see/manage users in their own warehouse; admin sees all. | ✅ |

## 6. Business rules

- Passwords are hashed with bcrypt on create/update and never returned.
- `roleId` must reference an existing role.

## 7. Acceptance criteria

- Creating a user with a duplicate email returns a validation error.
- A deactivated user can no longer log in.
- A user with only `users:read` sees the list but no Add/Edit/Delete buttons.
