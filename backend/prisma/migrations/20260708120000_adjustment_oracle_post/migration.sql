-- Inventory Adjustment: header class + Oracle inventory_adjustment_id
ALTER TABLE "inventory_adjustments"
  ADD COLUMN "class_id" TEXT,
  ADD COLUMN "oracle_id" TEXT NOT NULL DEFAULT '-';

ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_class_id_fkey"
  FOREIGN KEY ("class_id") REFERENCES "classes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
