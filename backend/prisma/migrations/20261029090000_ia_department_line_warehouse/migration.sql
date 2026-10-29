-- AlterTable
ALTER TABLE "inventory_adjustment_items" ADD COLUMN     "warehouse_id" TEXT;

-- AlterTable
ALTER TABLE "inventory_adjustments" ADD COLUMN     "department_id" TEXT;

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_warehouse_id_idx" ON "inventory_adjustment_items"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_adjustments_department_id_idx" ON "inventory_adjustments"("department_id");

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_items" ADD CONSTRAINT "inventory_adjustment_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing documents were single-warehouse, so every line sits in the
-- header warehouse; the department sent to Oracle was the creator's.
UPDATE "inventory_adjustment_items" AS it
SET "warehouse_id" = a."warehouse_id"
FROM "inventory_adjustments" AS a
WHERE it."adjustment_id" = a."id" AND it."warehouse_id" IS NULL;

UPDATE "inventory_adjustments" AS a
SET "department_id" = u."department_id"
FROM "users" AS u
WHERE a."created_by" = u."id" AND a."department_id" IS NULL;
