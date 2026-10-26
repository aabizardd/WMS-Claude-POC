-- AlterEnum
ALTER TYPE "GoodsReceiveSource" ADD VALUE 'TO';

-- AlterTable
ALTER TABLE "goods_receive_items" ADD COLUMN     "bin_id" TEXT,
ADD COLUMN     "material_code" TEXT,
ADD COLUMN     "qty_remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "transfer_order_item_id" TEXT;

-- AlterTable
ALTER TABLE "putaway_items" ADD COLUMN     "gr_item_id" TEXT,
ALTER COLUMN "mrn_item_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "goods_receive_items_bin_id_idx" ON "goods_receive_items"("bin_id");

-- CreateIndex
CREATE INDEX "goods_receive_items_transfer_order_item_id_idx" ON "goods_receive_items"("transfer_order_item_id");

-- CreateIndex
CREATE INDEX "putaway_items_gr_item_id_idx" ON "putaway_items"("gr_item_id");

-- AddForeignKey
ALTER TABLE "goods_receive_items" ADD CONSTRAINT "goods_receive_items_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receive_items" ADD CONSTRAINT "goods_receive_items_transfer_order_item_id_fkey" FOREIGN KEY ("transfer_order_item_id") REFERENCES "transfer_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "putaway_items" ADD CONSTRAINT "putaway_items_gr_item_id_fkey" FOREIGN KEY ("gr_item_id") REFERENCES "goods_receive_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

