-- CreateEnum
CREATE TYPE "SalesDeliveryStatus" AS ENUM ('Submitted');

-- CreateTable
CREATE TABLE "sales_deliveries" (
    "id" TEXT NOT NULL,
    "delivery_number" TEXT NOT NULL,
    "status" "SalesDeliveryStatus" NOT NULL DEFAULT 'Submitted',
    "from_warehouse_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "department_id" TEXT,
    "class_id" TEXT,
    "memo" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_delivery_items" (
    "id" TEXT NOT NULL,
    "sales_delivery_id" TEXT NOT NULL,
    "material_id" TEXT,
    "material_code" TEXT,
    "material_name" TEXT,
    "uom_code" TEXT,
    "bin_id" TEXT,
    "bin_label" TEXT,
    "qty_transfer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avail_at_create" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_deliveries_delivery_number_key" ON "sales_deliveries"("delivery_number");

-- CreateIndex
CREATE INDEX "sales_deliveries_from_warehouse_id_idx" ON "sales_deliveries"("from_warehouse_id");

-- CreateIndex
CREATE INDEX "sales_deliveries_to_warehouse_id_idx" ON "sales_deliveries"("to_warehouse_id");

-- CreateIndex
CREATE INDEX "sales_deliveries_status_idx" ON "sales_deliveries"("status");

-- CreateIndex
CREATE INDEX "sales_delivery_items_sales_delivery_id_idx" ON "sales_delivery_items"("sales_delivery_id");

-- CreateIndex
CREATE INDEX "sales_delivery_items_material_id_idx" ON "sales_delivery_items"("material_id");

-- CreateIndex
CREATE INDEX "sales_delivery_items_bin_id_idx" ON "sales_delivery_items"("bin_id");

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_delivery_items" ADD CONSTRAINT "sales_delivery_items_sales_delivery_id_fkey" FOREIGN KEY ("sales_delivery_id") REFERENCES "sales_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_delivery_items" ADD CONSTRAINT "sales_delivery_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_delivery_items" ADD CONSTRAINT "sales_delivery_items_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
