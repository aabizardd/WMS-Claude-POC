-- N pickings (same SO/TO) can merge into one packing.
-- pickings.packing_id = the packing this picking is a member of.
ALTER TABLE "pickings" ADD COLUMN "packing_id" TEXT;

ALTER TABLE "pickings" ADD CONSTRAINT "pickings_packing_id_fkey"
  FOREIGN KEY ("packing_id") REFERENCES "packings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pickings_packing_id_idx" ON "pickings"("packing_id");

-- Backfill: every existing packing has exactly one picking (legacy 1:1).
UPDATE "pickings" p
SET "packing_id" = pk."id"
FROM "packings" pk
WHERE pk."picking_id" = p."id";
