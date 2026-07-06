-- CreateEnum
CREATE TYPE "PackingStatus" AS ENUM ('Open');

-- CreateTable
CREATE TABLE "packings" (
    "id" TEXT NOT NULL,
    "packing_code" TEXT NOT NULL,
    "picking_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "status" "PackingStatus" NOT NULL DEFAULT 'Open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_items" (
    "id" TEXT NOT NULL,
    "packing_id" TEXT NOT NULL,
    "material_id" TEXT,
    "material_code" TEXT,
    "material_name" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bin_id" TEXT,
    "picker_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packings_packing_code_key" ON "packings"("packing_code");

-- CreateIndex
CREATE UNIQUE INDEX "packings_picking_id_key" ON "packings"("picking_id");

-- AddForeignKey
ALTER TABLE "packings" ADD CONSTRAINT "packings_picking_id_fkey" FOREIGN KEY ("picking_id") REFERENCES "pickings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packings" ADD CONSTRAINT "packings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_packing_id_fkey" FOREIGN KEY ("packing_id") REFERENCES "packings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_picker_id_fkey" FOREIGN KEY ("picker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
