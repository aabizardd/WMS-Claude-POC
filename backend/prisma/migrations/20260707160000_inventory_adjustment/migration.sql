-- Inventory Adjustment (create/list/detail; no inventory mutation yet)
CREATE TYPE "InventoryAdjustmentType" AS ENUM ('qty_issue', 'quality_issue');
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('PendingApproval', 'Approved', 'Rejected');

CREATE TABLE "inventory_adjustments" (
    "id" TEXT NOT NULL,
    "adjustment_number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "adjustment_type" "InventoryAdjustmentType" NOT NULL,
    "status" "InventoryAdjustmentStatus" NOT NULL DEFAULT 'PendingApproval',
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_adjustments_adjustment_number_key" ON "inventory_adjustments"("adjustment_number");

CREATE TABLE "inventory_adjustment_items" (
    "id" TEXT NOT NULL,
    "adjustment_id" TEXT NOT NULL,
    "material_id" TEXT,
    "material_code" TEXT,
    "material_name" TEXT,
    "bin_id" TEXT,
    "bin_label" TEXT,
    "qty_adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_scrapped" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_passed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avail_at_create" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_issue_at_create" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_issue_at_create" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_adjustment_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_adjustment_discrepancies" (
    "adjustment_id" TEXT NOT NULL,
    "discrepancy_id" TEXT NOT NULL,
    CONSTRAINT "inventory_adjustment_discrepancies_pkey" PRIMARY KEY ("adjustment_id", "discrepancy_id")
);

ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_items"
  ADD CONSTRAINT "inventory_adjustment_items_adjustment_id_fkey"
  FOREIGN KEY ("adjustment_id") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustment_items"
  ADD CONSTRAINT "inventory_adjustment_items_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustment_items"
  ADD CONSTRAINT "inventory_adjustment_items_bin_id_fkey"
  FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_discrepancies"
  ADD CONSTRAINT "inventory_adjustment_discrepancies_adjustment_id_fkey"
  FOREIGN KEY ("adjustment_id") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustment_discrepancies"
  ADD CONSTRAINT "inventory_adjustment_discrepancies_discrepancy_id_fkey"
  FOREIGN KEY ("discrepancy_id") REFERENCES "discrepancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
