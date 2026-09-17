-- Transfer Inventory document number, allocated alongside the SD number.
ALTER TABLE "sales_deliveries" ADD COLUMN "document_number" TEXT;

-- Backfill documents created before this column existed: TI-YYYYMMDD-NNN,
-- numbered per creation day in creation order so the result matches what the
-- application would have generated.
UPDATE "sales_deliveries" sd
SET "document_number" = t.num
FROM (
  SELECT
    id,
    'TI-' || to_char("created_at", 'YYYYMMDD') || '-' ||
      lpad(
        (row_number() OVER (PARTITION BY date("created_at") ORDER BY "created_at", id))::text,
        3,
        '0'
      ) AS num
  FROM "sales_deliveries"
) t
WHERE sd.id = t.id;

ALTER TABLE "sales_deliveries" ALTER COLUMN "document_number" SET NOT NULL;

CREATE UNIQUE INDEX "sales_deliveries_document_number_key" ON "sales_deliveries"("document_number");
