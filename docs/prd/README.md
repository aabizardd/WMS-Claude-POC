# WMS — Product Requirements Documents (PRD)

This folder holds the product requirements for the Warehouse Management System
(WMS). Each document describes one functional area: its goals, scope, data model,
API surface, business rules, and acceptance criteria.

| #   | Document | Scope |
| --- | -------- | ----- |
| 00  | [Product Overview](00-product-overview.md) | Vision, personas, architecture, tech stack, cross-cutting concerns |
| 01  | [Authentication & RBAC](01-auth-and-rbac.md) | Login (JWT), roles, permissions, route/menu/action gating |
| 02  | [User Management](02-user-management.md) | User master data + CRUD |
| 03  | [Material Management](03-material-management.md) | Materials, categories, types, UOM, ERP (Oracle) sync |
| 04  | [Warehouse Management](04-warehouse-management.md) | Warehouses (Oracle sync), area types, aisles, shelves, bins |
| 05  | [Vendor Management](05-vendor-management.md) | Vendors (Oracle sync, read-only) |
| 06  | [Customer Management](06-customer-management.md) | Customers (Oracle sync, read-only) |
| 07  | [Inbound](07-inbound.md) | MRN (Oracle PIB sync) & Goods Receive; Putaway/History planned |
| 08  | [Inventory Management](08-inventory-management.md) | Inventory rows + batches, generated on receive |

## Conventions

- **Permission keys** follow `resource:action` (e.g. `materials:update`, `warehouses:sync`).
- **Status legend** used per requirement: ✅ Implemented · 🔜 Planned · ⚠️ Partial.
- Document owner: Product · Last updated: 2026-06-30.

## Change log

| Date | Change |
| ---- | ------ |
| 2026-06-30 | Initial PRD set covering Auth/RBAC, Users, Material Management, Warehouse Management. |
| 2026-06-30 | Added Vendor Management (Oracle vendor sync, read-only). |
| 2026-06-30 | Added Customer Management (Oracle customer sync, read-only). |
| 2026-06-30 | Added Inbound — MRN (PIB sync) & Goods Receive (Putaway/History planned). |
| 2026-06-30 | Added Inventory Management — auto-generated rows + batches on Goods Receive. |
