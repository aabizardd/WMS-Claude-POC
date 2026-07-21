-- PO line number (Oracle linesequencenumber) — the "line" for item-receipt.
ALTER TABLE "purchase_order_lines" ADD COLUMN "line_number" INTEGER;

-- Received lines of a PO-sourced Goods Receive.
CREATE TABLE "goods_receive_items" (
  "id" TEXT NOT NULL,
  "goods_receive_id" TEXT NOT NULL,
  "line_number" INTEGER,
  "item_display" TEXT,
  "material_id" TEXT,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receive_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "goods_receive_items" ADD CONSTRAINT "goods_receive_items_goods_receive_id_fkey"
  FOREIGN KEY ("goods_receive_id") REFERENCES "goods_receives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "goods_receive_items_goods_receive_id_idx" ON "goods_receive_items"("goods_receive_id");
