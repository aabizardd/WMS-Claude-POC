-- Packing gains a progress/close flow (mirrors Picking)
ALTER TYPE "PackingStatus" ADD VALUE IF NOT EXISTS 'Closed';

ALTER TABLE "packing_items"
  ADD COLUMN "actual_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "qty_issue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "quality_issue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "remaining_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Existing packings are still in progress: remaining = full base qty.
UPDATE "packing_items" SET "remaining_qty" = "qty";
