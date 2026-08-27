-- PRD-06 revision: the Draft stage is removed. A document is created directly
-- into Waiting Approval, with the confirmation dialog on the create form acting
-- as the submission. "submitted_by"/"submitted_at" therefore always duplicated
-- "created_by"/"created_at" and are dropped.

-- Safety: nothing should be in Draft, but re-home any row if it is.
UPDATE "inventory_adjustments" SET "status" = 'WaitingApproval' WHERE "status" = 'Draft';

ALTER TABLE "inventory_adjustments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "InventoryAdjustmentStatus" RENAME TO "InventoryAdjustmentStatus_old";
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM (
  'WaitingApproval',
  'Approved',
  'Rejected',
  'WaitingOracleApproval',
  'Completed',
  'RejectedByOracle'
);
ALTER TABLE "inventory_adjustments"
  ALTER COLUMN "status" TYPE "InventoryAdjustmentStatus"
  USING ("status"::text::"InventoryAdjustmentStatus");
ALTER TABLE "inventory_adjustments" ALTER COLUMN "status" SET DEFAULT 'WaitingApproval';
DROP TYPE "InventoryAdjustmentStatus_old";

ALTER TABLE "inventory_adjustments" DROP CONSTRAINT IF EXISTS "inventory_adjustments_submitted_by_fkey";
ALTER TABLE "inventory_adjustments" DROP COLUMN IF EXISTS "submitted_by";
ALTER TABLE "inventory_adjustments" DROP COLUMN IF EXISTS "submitted_at";
