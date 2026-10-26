-- Per-line note captured when a bin is added on the Sales Delivery create form.
-- Nullable, so existing lines keep their current content.
ALTER TABLE "sales_delivery_items" ADD COLUMN "remarks" TEXT;
