-- AlterTable
ALTER TABLE "goods_receive_items" ADD COLUMN     "customer_return_line_id" TEXT;

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "tran_id" TEXT,
    "tran_date" TEXT,
    "status_code" TEXT,
    "status_name" TEXT,
    "memo" TEXT,
    "customer_id" TEXT,
    "customer_name" TEXT,
    "created_from_id" TEXT,
    "created_from_display" TEXT,
    "other_ref_num" TEXT,
    "subsidiary_id" TEXT,
    "subsidiary_display" TEXT,
    "class_display" TEXT,
    "department_display" TEXT,
    "location_oracle_id" TEXT,
    "location_name" TEXT,
    "warehouse_id" TEXT,
    "date_created" TEXT,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_lines" (
    "id" TEXT NOT NULL,
    "customer_return_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "line_number" INTEGER,
    "item_oracle_id" TEXT,
    "item_display" TEXT,
    "description" TEXT,
    "units" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "location_oracle_id" TEXT,
    "location_name" TEXT,
    "department_display" TEXT,
    "class_display" TEXT,
    "material_id" TEXT,

    CONSTRAINT "customer_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_oracle_id_key" ON "customer_returns"("oracle_id");

-- CreateIndex
CREATE INDEX "customer_returns_warehouse_id_idx" ON "customer_returns"("warehouse_id");

-- CreateIndex
CREATE INDEX "customer_returns_status_code_idx" ON "customer_returns"("status_code");

-- CreateIndex
CREATE INDEX "customer_returns_subsidiary_id_idx" ON "customer_returns"("subsidiary_id");

-- CreateIndex
CREATE INDEX "customer_return_lines_customer_return_id_idx" ON "customer_return_lines"("customer_return_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_return_lines_customer_return_id_line_id_key" ON "customer_return_lines"("customer_return_id", "line_id");

-- CreateIndex
CREATE INDEX "goods_receive_items_customer_return_line_id_idx" ON "goods_receive_items"("customer_return_line_id");

-- AddForeignKey
ALTER TABLE "goods_receive_items" ADD CONSTRAINT "goods_receive_items_customer_return_line_id_fkey" FOREIGN KEY ("customer_return_line_id") REFERENCES "customer_return_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_customer_return_id_fkey" FOREIGN KEY ("customer_return_id") REFERENCES "customer_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
