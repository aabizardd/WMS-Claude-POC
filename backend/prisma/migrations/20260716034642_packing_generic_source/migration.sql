-- AlterTable
ALTER TABLE "packing_items" ADD COLUMN     "transfer_order_item_id" TEXT;

-- AlterTable
ALTER TABLE "packings" ADD COLUMN     "source_type" "OutboundSource" NOT NULL DEFAULT 'SALES_ORDER';

-- CreateIndex
CREATE INDEX "packing_items_transfer_order_item_id_idx" ON "packing_items"("transfer_order_item_id");

-- AddForeignKey
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_transfer_order_item_id_fkey" FOREIGN KEY ("transfer_order_item_id") REFERENCES "transfer_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
