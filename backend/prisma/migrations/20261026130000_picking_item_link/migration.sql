-- AlterTable
ALTER TABLE "delivery_items" ADD COLUMN     "picking_item_id" TEXT;

-- AlterTable
ALTER TABLE "packing_items" ADD COLUMN     "picking_item_id" TEXT;

-- CreateIndex
CREATE INDEX "delivery_items_picking_item_id_idx" ON "delivery_items"("picking_item_id");

-- CreateIndex
CREATE INDEX "packing_items_picking_item_id_idx" ON "packing_items"("picking_item_id");

-- AddForeignKey
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_picking_item_id_fkey" FOREIGN KEY ("picking_item_id") REFERENCES "picking_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_picking_item_id_fkey" FOREIGN KEY ("picking_item_id") REFERENCES "picking_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: link existing packing lines to the picking line they came from.
-- Candidates are the lines of the packing's pickings for the same SO / TO
-- line; the one with the same bin, then the same quantity, wins.
UPDATE "packing_items" pa
SET "picking_item_id" = (
  SELECT pi."id"
  FROM "picking_items" pi
  JOIN "pickings" pk ON pk."id" = pi."picking_id"
  JOIN "packings" p ON p."id" = pa."packing_id"
  WHERE (pk."id" = p."picking_id" OR pk."packing_id" = p."id")
    AND pi."actual_qty" > 0
    AND (
      (pa."sales_order_item_id" IS NOT NULL AND pi."sales_order_item_id" = pa."sales_order_item_id")
      OR (pa."transfer_order_item_id" IS NOT NULL AND pi."transfer_order_item_id" = pa."transfer_order_item_id")
    )
  ORDER BY (pi."bin_id" IS NOT DISTINCT FROM pa."bin_id") DESC,
           (pi."actual_qty" = pa."qty") DESC,
           pi."created_at", pi."id"
  LIMIT 1
)
WHERE pa."picking_item_id" IS NULL;

-- Backfill: delivery lines take the link of the packing line they came from.
UPDATE "delivery_items" di
SET "picking_item_id" = (
  SELECT pa."picking_item_id"
  FROM "packing_items" pa
  JOIN "deliveries" d ON d."packing_id" = pa."packing_id"
  WHERE d."id" = di."delivery_id"
    AND (
      (di."sales_order_item_id" IS NOT NULL AND pa."sales_order_item_id" = di."sales_order_item_id")
      OR (di."transfer_order_item_id" IS NOT NULL AND pa."transfer_order_item_id" = di."transfer_order_item_id")
    )
  ORDER BY (pa."bin_id" IS NOT DISTINCT FROM di."bin_id") DESC,
           (pa."actual_qty" = di."qty") DESC,
           pa."created_at", pa."id"
  LIMIT 1
)
WHERE di."picking_item_id" IS NULL;
