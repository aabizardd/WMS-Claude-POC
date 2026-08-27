-- PRD-06 Inventory Adjustment alignment.
--
-- The two IA enums are replaced wholesale (2 types -> 7, 3 statuses -> 7), so the
-- existing adjustment documents cannot be mapped and are removed first (agreed
-- with the product owner: the 4 rows were test data).

-- 1. Drop existing IA documents (children first).
DELETE FROM "inventory_adjustment_discrepancies";
DELETE FROM "inventory_adjustment_items";
DELETE FROM "inventory_adjustments";

-- 2. Replace InventoryAdjustmentType (qty_issue|quality_issue -> the 7 PRD types).
ALTER TYPE "InventoryAdjustmentType" RENAME TO "InventoryAdjustmentType_old";
CREATE TYPE "InventoryAdjustmentType" AS ENUM (
  'DiscrepancyQuantity',
  'DiscrepancyQuality',
  'QualityAdjustment',
  'Assembly',
  'Disassembly',
  'CycleCount',
  'StockOpname'
);
ALTER TABLE "inventory_adjustments"
  ALTER COLUMN "adjustment_type" TYPE "InventoryAdjustmentType"
  USING ('CycleCount'::"InventoryAdjustmentType");
DROP TYPE "InventoryAdjustmentType_old";

-- 3. Replace InventoryAdjustmentStatus and default new documents to Draft.
ALTER TABLE "inventory_adjustments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "InventoryAdjustmentStatus" RENAME TO "InventoryAdjustmentStatus_old";
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM (
  'Draft',
  'WaitingApproval',
  'Approved',
  'Rejected',
  'WaitingOracleApproval',
  'Completed',
  'RejectedByOracle'
);
ALTER TABLE "inventory_adjustments"
  ALTER COLUMN "status" TYPE "InventoryAdjustmentStatus"
  USING ('Draft'::"InventoryAdjustmentStatus");
ALTER TABLE "inventory_adjustments" ALTER COLUMN "status" SET DEFAULT 'Draft';
DROP TYPE "InventoryAdjustmentStatus_old";

-- 4. Header: note -> memo, plus submit / Oracle / completion tracking.
ALTER TABLE "inventory_adjustments" RENAME COLUMN "note" TO "memo";
ALTER TABLE "inventory_adjustments"
  ADD COLUMN "submitted_by"         INTEGER,
  ADD COLUMN "submitted_at"         TIMESTAMP(3),
  ADD COLUMN "oracle_sent_at"       TIMESTAMP(3),
  ADD COLUMN "oracle_error"         TEXT,
  ADD COLUMN "oracle_reject_reason" TEXT,
  ADD COLUMN "completed_at"         TIMESTAMP(3);
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_submitted_by_fkey"
  FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Item: qty_scrapped -> qty_non_passed (PRD wording).
ALTER TABLE "inventory_adjustment_items" RENAME COLUMN "qty_scrapped" TO "qty_non_passed";

-- 6. FR-IA-11 rule 4: decimals allowed only when the UoM supports them.
ALTER TABLE "uoms" ADD COLUMN "allows_decimal" BOOLEAN NOT NULL DEFAULT true;

-- 7. FR-IA-15: append-only audit trail.
CREATE TABLE "inventory_adjustment_events" (
  "id"            TEXT NOT NULL,
  "adjustment_id" TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "from_status"   TEXT,
  "to_status"     TEXT,
  "actor_id"      INTEGER,
  "message"       TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_adjustment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_adjustment_events_adjustment_id_idx"
  ON "inventory_adjustment_events"("adjustment_id");
ALTER TABLE "inventory_adjustment_events"
  ADD CONSTRAINT "inventory_adjustment_events_adjustment_id_fkey"
  FOREIGN KEY ("adjustment_id") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustment_events"
  ADD CONSTRAINT "inventory_adjustment_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
