-- Move qtyInTransit to the inventory header (Oracle-mirrored, like committed/on-order).
ALTER TABLE "inventory_management"
  ADD COLUMN "qty_in_transit" DOUBLE PRECISION NOT NULL DEFAULT 0;
