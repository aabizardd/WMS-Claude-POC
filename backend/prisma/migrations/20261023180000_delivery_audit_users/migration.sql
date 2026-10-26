-- Who generated a delivery and who last changed it. Existing rows stay null:
-- the creator was never recorded before this migration.
ALTER TABLE "deliveries"
  ADD COLUMN "created_by_id" INTEGER,
  ADD COLUMN "updated_by_id" INTEGER;

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
