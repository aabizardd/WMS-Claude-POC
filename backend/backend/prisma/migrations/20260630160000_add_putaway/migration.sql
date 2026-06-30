-- CreateEnum
CREATE TYPE "PutawayStatus" AS ENUM ('Open', 'OnProgress', 'Closed');

-- CreateTable
CREATE TABLE "putaways" (
    "id" TEXT NOT NULL,
    "putaway_code" TEXT NOT NULL,
    "gr_id" TEXT,
    "warehouse_id" TEXT,
    "status" "PutawayStatus" NOT NULL DEFAULT 'Open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "putaways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "putaway_items" (
    "id" TEXT NOT NULL,
    "putaway_id" TEXT NOT NULL,
    "mrn_item_id" TEXT NOT NULL,
    "item_name" TEXT,
    "po_number" TEXT,
    "material_code" TEXT,
    "vendor_name" TEXT,
    "planned_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "picker_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "putaway_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "putaways_putaway_code_key" ON "putaways"("putaway_code");

-- AddForeignKey
ALTER TABLE "putaways" ADD CONSTRAINT "putaways_gr_id_fkey" FOREIGN KEY ("gr_id") REFERENCES "goods_receives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "putaways" ADD CONSTRAINT "putaways_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "putaway_items" ADD CONSTRAINT "putaway_items_putaway_id_fkey" FOREIGN KEY ("putaway_id") REFERENCES "putaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "putaway_items" ADD CONSTRAINT "putaway_items_mrn_item_id_fkey" FOREIGN KEY ("mrn_item_id") REFERENCES "mrn_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "putaway_items" ADD CONSTRAINT "putaway_items_picker_id_fkey" FOREIGN KEY ("picker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
