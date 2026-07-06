-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('Open', 'ProgressPicking');

-- CreateEnum
CREATE TYPE "PickingStatus" AS ENUM ('Open');

-- AlterTable: Sales Order delivery status
ALTER TABLE "sales_orders" ADD COLUMN "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'Open';

-- AlterTable: Sales Order item remaining qty (backfill to quantity for existing rows)
ALTER TABLE "sales_order_items" ADD COLUMN "remaining_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "sales_order_items" SET "remaining_qty" = "quantity";

-- CreateTable
CREATE TABLE "pickings" (
    "id" TEXT NOT NULL,
    "picking_code" TEXT NOT NULL,
    "sdo_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "status" "PickingStatus" NOT NULL DEFAULT 'Open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picking_items" (
    "id" TEXT NOT NULL,
    "picking_id" TEXT NOT NULL,
    "sales_order_item_id" TEXT NOT NULL,
    "material_id" TEXT,
    "material_code" TEXT,
    "material_name" TEXT,
    "request_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bin_id" TEXT,
    "picker_id" INTEGER,
    "status" "PickingStatus" NOT NULL DEFAULT 'Open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picking_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pickings_picking_code_key" ON "pickings"("picking_code");

-- CreateIndex
CREATE UNIQUE INDEX "pickings_sdo_id_key" ON "pickings"("sdo_id");

-- AddForeignKey
ALTER TABLE "pickings" ADD CONSTRAINT "pickings_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickings" ADD CONSTRAINT "pickings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_picking_id_fkey" FOREIGN KEY ("picking_id") REFERENCES "pickings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_picker_id_fkey" FOREIGN KEY ("picker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
