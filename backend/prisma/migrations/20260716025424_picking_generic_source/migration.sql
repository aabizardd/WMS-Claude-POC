-- CreateEnum
CREATE TYPE "OutboundSource" AS ENUM ('SALES_ORDER', 'TRANSFER_ORDER');

-- DropForeignKey
ALTER TABLE "picking_items" DROP CONSTRAINT "picking_items_sales_order_item_id_fkey";

-- DropForeignKey
ALTER TABLE "pickings" DROP CONSTRAINT "pickings_sales_order_id_fkey";

-- AlterTable
ALTER TABLE "picking_items" ADD COLUMN     "transfer_order_item_id" TEXT,
ALTER COLUMN "sales_order_item_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pickings" ADD COLUMN     "source_type" "OutboundSource" NOT NULL DEFAULT 'SALES_ORDER',
ADD COLUMN     "transfer_order_id" TEXT,
ALTER COLUMN "sales_order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transfer_order_items" ADD COLUMN     "remaining_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill WMS remaining-to-pick = committed for existing transfer order items.
UPDATE "transfer_order_items" SET "remaining_qty" = "committed";

-- CreateIndex
CREATE INDEX "picking_items_transfer_order_item_id_idx" ON "picking_items"("transfer_order_item_id");

-- CreateIndex
CREATE INDEX "pickings_transfer_order_id_idx" ON "pickings"("transfer_order_id");

-- AddForeignKey
ALTER TABLE "pickings" ADD CONSTRAINT "pickings_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickings" ADD CONSTRAINT "pickings_transfer_order_id_fkey" FOREIGN KEY ("transfer_order_id") REFERENCES "transfer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_transfer_order_item_id_fkey" FOREIGN KEY ("transfer_order_item_id") REFERENCES "transfer_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
