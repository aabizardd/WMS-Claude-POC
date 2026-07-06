-- CreateEnum
CREATE TYPE "DiscrepancyType" AS ENUM ('quantity', 'quality');

-- CreateEnum
CREATE TYPE "DiscrepancyFrom" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "DiscrepancySource" AS ENUM ('GR', 'Putaway', 'Picking', 'Packing');

-- CreateEnum
CREATE TYPE "QtyDiscrepancyType" AS ENUM ('shortage', 'overage', 'quarantine');

-- CreateTable
CREATE TABLE "discrepancies" (
    "id" TEXT NOT NULL,
    "discrepancy_id" TEXT NOT NULL,
    "gr_id" TEXT,
    "reported_by" INTEGER,
    "discrepancy_type" "DiscrepancyType" NOT NULL,
    "discrepancy_from" "DiscrepancyFrom" NOT NULL,
    "warehouse_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "r_discrepancy_detail" (
    "id" TEXT NOT NULL,
    "discrepancy_id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "item_name" TEXT,
    "mrn_item_id" TEXT,
    "source_from" "DiscrepancySource" NOT NULL,
    "qty_discrepancy" INTEGER NOT NULL,
    "qty_passed" INTEGER NOT NULL DEFAULT 0,
    "qty_scrapped" INTEGER NOT NULL DEFAULT 0,
    "qty_remaining" INTEGER NOT NULL,
    "qty_discrepancy_type" "QtyDiscrepancyType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "r_discrepancy_detail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discrepancies_discrepancy_id_key" ON "discrepancies"("discrepancy_id");

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_gr_id_fkey" FOREIGN KEY ("gr_id") REFERENCES "goods_receives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "r_discrepancy_detail" ADD CONSTRAINT "r_discrepancy_detail_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "discrepancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
