-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "source_type" "OutboundSource" NOT NULL DEFAULT 'SALES_ORDER';

-- AlterTable
ALTER TABLE "delivery_items" ADD COLUMN     "transfer_order_item_id" TEXT;

-- CreateIndex
CREATE INDEX "delivery_items_transfer_order_item_id_idx" ON "delivery_items"("transfer_order_item_id");

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_transfer_order_item_id_fkey" FOREIGN KEY ("transfer_order_item_id") REFERENCES "transfer_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
