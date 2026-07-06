-- Remaining-to-pick now derives from Oracle `shipped`: remaining = qty - shipped.
-- Correct existing partially-shipped lines only (shipped > 0); lines with
-- shipped = 0 keep their WMS-managed remaining (in-progress picking decrements).
UPDATE "sales_order_items"
SET "remaining_qty" = GREATEST(0, "quantity" - "shipped")
WHERE "shipped" > 0;
