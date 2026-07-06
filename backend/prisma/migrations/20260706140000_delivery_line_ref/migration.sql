-- Carry the origin Sales Order line down to packing & delivery items
ALTER TABLE "packing_items" ADD COLUMN "sales_order_item_id" TEXT;
ALTER TABLE "delivery_items" ADD COLUMN "sales_order_item_id" TEXT;

ALTER TABLE "packing_items"
  ADD CONSTRAINT "packing_items_sales_order_item_id_fkey"
  FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_items"
  ADD CONSTRAINT "delivery_items_sales_order_item_id_fkey"
  FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Best-effort backfill for existing packing items: only where a (packing,
-- material_code) resolves to exactly ONE picking line (ambiguous ones stay NULL).
WITH single AS (
  SELECT pg.id AS packing_id,
         pit."material_code" AS material_code,
         MIN(pit."sales_order_item_id") AS soi_id,
         COUNT(*) AS c
  FROM "packings" pg
  JOIN "picking_items" pit ON pit."picking_id" = pg."picking_id"
  GROUP BY pg.id, pit."material_code"
)
UPDATE "packing_items" pk
SET "sales_order_item_id" = s.soi_id
FROM single s
WHERE s.packing_id = pk."packing_id"
  AND s.material_code = pk."material_code"
  AND s.c = 1;

-- Propagate the backfilled reference into existing delivery items (via the
-- delivery's packing), again only for unambiguous material_code matches.
WITH single AS (
  SELECT pk."packing_id",
         pk."material_code",
         MIN(pk."sales_order_item_id") AS soi_id,
         COUNT(*) AS c
  FROM "packing_items" pk
  WHERE pk."sales_order_item_id" IS NOT NULL
  GROUP BY pk."packing_id", pk."material_code"
)
UPDATE "delivery_items" di
SET "sales_order_item_id" = s.soi_id
FROM "deliveries" d
JOIN single s ON s."packing_id" = d."packing_id"
WHERE di."delivery_id" = d.id
  AND di."material_code" = s.material_code
  AND s.c = 1;
