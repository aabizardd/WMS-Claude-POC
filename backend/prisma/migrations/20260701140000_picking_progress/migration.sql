-- AlterEnum: picking statuses for progress tracking
ALTER TYPE "PickingStatus" ADD VALUE IF NOT EXISTS 'OnProgress';
ALTER TYPE "PickingStatus" ADD VALUE IF NOT EXISTS 'Closed';

-- AlterTable: picking item progress fields
ALTER TABLE "picking_items" ADD COLUMN "actual_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "picking_items" ADD COLUMN "qty_issue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "picking_items" ADD COLUMN "quality_issue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "picking_items" ADD COLUMN "remaining_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "picking_items" SET "remaining_qty" = "request_qty";

-- AlterTable: discrepancy outbound source (Picking)
ALTER TABLE "discrepancies" ADD COLUMN "picking_id" TEXT;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_picking_id_fkey" FOREIGN KEY ("picking_id") REFERENCES "pickings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
