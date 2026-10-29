-- One user, many warehouses (WMS dev). users.warehouse_id moves into a join
-- table; each user's old warehouse becomes their first assignment.

-- CreateTable
CREATE TABLE "user_warehouses" (
    "user_id" INTEGER NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warehouses_pkey" PRIMARY KEY ("user_id","warehouse_id")
);

-- CreateIndex
CREATE INDEX "user_warehouses_warehouse_id_idx" ON "user_warehouses"("warehouse_id");

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill
INSERT INTO "user_warehouses" ("user_id", "warehouse_id")
SELECT "id", "warehouse_id" FROM "users" WHERE "warehouse_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_warehouse_id_fkey";

-- DropIndex
DROP INDEX "users_warehouse_id_idx";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "warehouse_id";
