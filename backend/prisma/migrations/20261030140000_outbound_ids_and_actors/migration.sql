-- WMS outbound number ("SO ID" on WMS dev) on Sales and Transfer Orders.
ALTER TABLE "sales_orders" ADD COLUMN "outbound_id" TEXT;
ALTER TABLE "transfer_orders" ADD COLUMN "outbound_id" TEXT;
CREATE UNIQUE INDEX "sales_orders_outbound_id_key" ON "sales_orders"("outbound_id");
CREATE UNIQUE INDEX "transfer_orders_outbound_id_key" ON "transfer_orders"("outbound_id");

-- Backfill: OUT<yyyymmdd>-<nnn> by the day each order reached WMS (WIB), one
-- sequence per day shared by both kinds, in creation order.
WITH u AS (
  SELECT 'SO' AS kind, id, created_at FROM "sales_orders"
  UNION ALL
  SELECT 'TO' AS kind, id, created_at FROM "transfer_orders"
), n AS (
  SELECT kind, id,
    'OUT' || to_char(created_at + interval '7 hours', 'YYYYMMDD') || '-' ||
    lpad(row_number() OVER (
      PARTITION BY to_char(created_at + interval '7 hours', 'YYYYMMDD')
      ORDER BY created_at, id
    )::text, 3, '0') AS v
  FROM u
)
UPDATE "sales_orders" s SET "outbound_id" = n.v FROM n WHERE n.kind = 'SO' AND n.id = s.id;

WITH u AS (
  SELECT 'SO' AS kind, id, created_at FROM "sales_orders"
  UNION ALL
  SELECT 'TO' AS kind, id, created_at FROM "transfer_orders"
), n AS (
  SELECT kind, id,
    'OUT' || to_char(created_at + interval '7 hours', 'YYYYMMDD') || '-' ||
    lpad(row_number() OVER (
      PARTITION BY to_char(created_at + interval '7 hours', 'YYYYMMDD')
      ORDER BY created_at, id
    )::text, 3, '0') AS v
  FROM u
)
UPDATE "transfer_orders" t SET "outbound_id" = n.v FROM n WHERE n.kind = 'TO' AND n.id = t.id;

-- Who generated / last progressed a picking or packing.
ALTER TABLE "pickings" ADD COLUMN "created_by_id" INTEGER, ADD COLUMN "updated_by_id" INTEGER;
ALTER TABLE "packings" ADD COLUMN "created_by_id" INTEGER, ADD COLUMN "updated_by_id" INTEGER;
ALTER TABLE "pickings" ADD CONSTRAINT "pickings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pickings" ADD CONSTRAINT "pickings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "packings" ADD CONSTRAINT "packings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "packings" ADD CONSTRAINT "packings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
