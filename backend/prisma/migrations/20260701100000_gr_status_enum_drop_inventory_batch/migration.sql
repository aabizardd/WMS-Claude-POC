-- ============================================================
-- 1) Goods Receive status -> enum
-- ============================================================

-- CreateEnum
CREATE TYPE "GoodsReceiveStatus" AS ENUM ('Open', 'Syncing', 'OnProgress', 'SyncFailed', 'Closed');

-- Normalise existing free-text values to the enum member names (drop spaces).
UPDATE "goods_receives" SET "status" = 'OnProgress' WHERE "status" = 'On Progress';
UPDATE "goods_receives" SET "status" = 'SyncFailed' WHERE "status" = 'Sync Failed';
-- Legacy/never-produced values collapse to a safe existing state.
UPDATE "goods_receives"
  SET "status" = 'OnProgress'
  WHERE "status" IN ('Partially Received', 'Received', 'Completed');

-- Convert the column type.
ALTER TABLE "goods_receives" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "goods_receives"
  ALTER COLUMN "status" TYPE "GoodsReceiveStatus" USING ("status"::"GoodsReceiveStatus");
ALTER TABLE "goods_receives" ALTER COLUMN "status" SET DEFAULT 'Open';

-- ============================================================
-- 2) Idempotency guard for inventory generation
-- ============================================================

-- AlterTable
ALTER TABLE "mrn_items" ADD COLUMN "inventoried_at" TIMESTAMP(3);

-- Backfill: MRN items that already produced an inventory batch are considered inventoried.
UPDATE "mrn_items" mi
  SET "inventoried_at" = now()
  FROM "inventory_batches" ib
  WHERE ib."mrn_item_id" = mi."id";

-- ============================================================
-- 3) Drop InventoryBatch (superseded by inventory_bin_stocks)
-- ============================================================

-- DropTable
DROP TABLE "inventory_batches";
