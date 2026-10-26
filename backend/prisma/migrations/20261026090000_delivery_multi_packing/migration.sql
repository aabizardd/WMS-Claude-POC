-- A delivery may now cover several packings.
-- The authoritative link moves to the line; deliveries.packing_id stays as the
-- packing the document was generated from first.
DROP INDEX IF EXISTS "deliveries_packing_id_key";

ALTER TABLE "delivery_items" ADD COLUMN "packing_id" TEXT;

CREATE INDEX "delivery_items_packing_id_idx" ON "delivery_items"("packing_id");

ALTER TABLE "delivery_items"
  ADD CONSTRAINT "delivery_items_packing_id_fkey"
  FOREIGN KEY ("packing_id") REFERENCES "packings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing lines belong to their delivery's single packing.
UPDATE "delivery_items" di
SET "packing_id" = d."packing_id"
FROM "deliveries" d
WHERE di."delivery_id" = d."id" AND di."packing_id" IS NULL;
