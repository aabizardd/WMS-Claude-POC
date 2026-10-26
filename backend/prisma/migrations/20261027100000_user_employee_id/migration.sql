-- Company employee number on users; optional, unique when set.
ALTER TABLE "users" ADD COLUMN "employee_id" TEXT;
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");
