-- Inventory Adjustment approval (WH Manager) fields
ALTER TABLE "inventory_adjustments"
  ADD COLUMN "approved_by" INTEGER,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "approval_reason" TEXT,
  ADD COLUMN "oracle_approval_status" TEXT NOT NULL DEFAULT '-';

ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_approved_by_fkey"
  FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
