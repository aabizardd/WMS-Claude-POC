-- User optional org assignment: department + subsidiary (nullable)
ALTER TABLE "users"
  ADD COLUMN "department_id" TEXT,
  ADD COLUMN "subsidiary_id" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_subsidiary_id_fkey"
  FOREIGN KEY ("subsidiary_id") REFERENCES "subsidiaries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
