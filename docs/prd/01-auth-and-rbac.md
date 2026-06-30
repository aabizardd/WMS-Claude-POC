# PRD 01 — Authentication & RBAC

## 1. Overview

Users authenticate with username + password and receive a JWT access token that
embeds their role and permission keys. Authorization is permission-based and
enforced on both the API (guards) and the UI (menu/route/action gating).

## 2. Objectives

- Secure login with hashed credentials.
- Granular, role-based access down to CRUD + sync actions per module.
- Immediate, consistent enforcement on backend and frontend.

## 3. Data model

| Entity | Key fields | Notes |
| ------ | ---------- | ----- |
| `roles` | `id`, `name` (unique), `description` | One role per user. |
| `permissions` | `id`, `key` (unique, `resource:action`), `resource`, `action`, `description` | Seeded catalog. |
| `role_permissions` | (`roleId`, `permissionId`) | Join table; cascade on delete. |
| `users` | see [PRD 02](02-user-management.md) | `roleId` FK. |

### Permission catalog (seeded)

`resource:action` for: `users`, `roles`, `material-categories`, `material-types`,
`uoms`, `area-types`, `aisles`, `shelves`, `bins` → actions `read/create/update/delete`;
`materials` → `read/update/sync`; `warehouses` → `read/sync`. **41 permissions** total.

Seeded roles: `admin` (all permissions, superuser) and `staff` (read-only baseline).

## 4. Authentication flow

1. `POST /api/auth/login { username, password }` → validates with bcrypt; rejects
   inactive users.
2. Returns `{ accessToken, user: { id, name, email, username, role, permissions[] } }`.
3. The JWT payload contains `sub`, `username`, `role`, `permissions[]`.
4. Client stores the token and sends `Authorization: Bearer <token>`.
5. `GET /api/auth/me` returns the current user (re-reads role + permissions).

> **Decision:** permissions are embedded in the JWT. Changes to a role's
> permissions take effect for a user **after they log in again**.

## 5. Authorization

- **Backend:** a global `JwtAuthGuard` (auth) + global `PermissionsGuard` (authz).
  Routes declare `@RequirePermissions('key', ...)`. Routes without the decorator
  are open to any authenticated user. The `admin` role bypasses all checks.
- **Frontend:** `useAuth().has(key)` / `hasAny([...])`; `admin` always returns true.
  - Sidebar items hidden when the user lacks the item's `read` permission; a group
    disappears when it has no visible children.
  - Routes wrapped in `RequirePermission` render a 403 panel when not allowed.
  - Add/Edit/Delete/Sync buttons hidden without the matching permission.

## 6. API surface

| Method | Endpoint | Permission | Description |
| ------ | -------- | ---------- | ----------- |
| POST | `/api/auth/login` | public | Login, returns JWT + user |
| GET | `/api/auth/me` | auth | Current user |
| GET | `/api/permissions` | `roles:read` | Permission catalog (for the role matrix) |
| GET | `/api/roles` | `roles:read` | List roles + assigned permissions |
| GET | `/api/roles/options` | auth | Lightweight role lookup (id, name) |
| POST | `/api/roles` | `roles:create` | Create role with `permissionIds[]` |
| PUT | `/api/roles/:id` | `roles:update` | Update role + replace permissions |
| DELETE | `/api/roles/:id` | `roles:delete` | Delete role (blocked if users assigned) |

## 7. Functional requirements

| ID | Requirement | Status |
| -- | ----------- | ------ |
| AUTH-1 | User logs in with username/password and receives a JWT. | ✅ |
| AUTH-2 | Inactive users cannot log in. | ✅ |
| AUTH-3 | Token carries role + permission keys. | ✅ |
| AUTH-4 | 401 responses clear the client token and redirect to login. | ✅ |
| RBAC-1 | Admin can create/edit roles and assign permissions via a module × action matrix. | ✅ |
| RBAC-2 | API rejects unauthorized actions with 403. | ✅ |
| RBAC-3 | UI hides menus/routes/buttons the user cannot use. | ✅ |
| RBAC-4 | `admin` role is a superuser and cannot be permission-restricted. | ✅ |

## 8. Business rules

- A role still assigned to one or more users cannot be deleted.
- The `admin` role name is reserved as superuser; its matrix is not editable.
- Dropdown lookups (`/options`) require only authentication, so a role that manages
  one module doesn't need full `read` on referenced modules.

## 9. Acceptance criteria

- Logging in as `staff` shows only permitted menus; visiting a forbidden route shows
  the 403 panel; calling a forbidden API returns 403.
- Granting `staff` a new permission and re-logging in reveals the corresponding menu
  and actions.
