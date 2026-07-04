-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "tran_id" TEXT,
    "tran_date" TEXT,
    "status_code" TEXT,
    "status_name" TEXT,
    "customer_id" TEXT,
    "customer_name" TEXT,
    "memo" TEXT,
    "location_oracle_id" TEXT,
    "location_name" TEXT,
    "warehouse_id" TEXT,
    "subsidiary_id" TEXT,
    "subsidiary_name" TEXT,
    "currency_id" TEXT,
    "currency_name" TEXT,
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_modified" TIMESTAMP(3),
    "date_created" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_oracle_id" TEXT,
    "item_name" TEXT,
    "material_id" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipped" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_oracle_id_key" ON "sales_orders"("oracle_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_sales_order_id_line_number_key" ON "sales_order_items"("sales_order_id", "line_number");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
