-- PO source: a GR line points at the Purchase Order line it receives.
ALTER TABLE "goods_receive_items" ADD COLUMN "purchase_order_line_id" TEXT;

CREATE INDEX "goods_receive_items_purchase_order_line_id_idx" ON "goods_receive_items"("purchase_order_line_id");

ALTER TABLE "goods_receive_items" ADD CONSTRAINT "goods_receive_items_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
