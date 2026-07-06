-- CreateTable
CREATE TABLE "inventory_management" (
    "id" TEXT NOT NULL,
    "material_code" TEXT NOT NULL,
    "material_id" TEXT,
    "warehouse_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_management_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_batches" (
    "id" TEXT NOT NULL,
    "inventory_id" TEXT NOT NULL,
    "reserved_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avail_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "in_transit_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_issue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_issue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bin_id" TEXT,
    "goods_receive_id" TEXT,
    "mrn_item_id" TEXT NOT NULL,
    "vendor_company_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_management_material_code_warehouse_id_key" ON "inventory_management"("material_code", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batches_mrn_item_id_key" ON "inventory_batches"("mrn_item_id");

-- AddForeignKey
ALTER TABLE "inventory_management" ADD CONSTRAINT "inventory_management_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_management" ADD CONSTRAINT "inventory_management_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_management"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_goods_receive_id_fkey" FOREIGN KEY ("goods_receive_id") REFERENCES "goods_receives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_mrn_item_id_fkey" FOREIGN KEY ("mrn_item_id") REFERENCES "mrn_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

