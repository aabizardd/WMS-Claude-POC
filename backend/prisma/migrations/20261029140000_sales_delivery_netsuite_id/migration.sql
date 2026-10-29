-- AlterTable
ALTER TABLE "sales_deliveries" ADD COLUMN     "netsuite_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_deliveries_netsuite_id_key" ON "sales_deliveries"("netsuite_id");

-- Backfill: a dummy NetSuite id for every existing document, rising with the
-- creation order in uneven steps (1-120), the way real internal ids look.
-- Six digits like WMS dev's, so they also sort right as text.
UPDATE "sales_deliveries" sd
SET "netsuite_id" = x.id_value::text
FROM (
  SELECT id, 110000 + SUM(step) OVER (ORDER BY created_at, id) AS id_value
  FROM (SELECT id, created_at, 1 + floor(random() * 120)::int AS step FROM "sales_deliveries") s
) x
WHERE sd.id = x.id;
