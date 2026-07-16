-- CreateTable
CREATE TABLE "transfer_orders" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "tran_id" TEXT,
    "tran_date" TEXT,
    "status_code" TEXT,
    "status_name" TEXT,
    "from_location_oracle_id" TEXT,
    "from_location_name" TEXT,
    "warehouse_id" TEXT,
    "to_location_oracle_id" TEXT,
    "to_location_name" TEXT,
    "to_warehouse_id" TEXT,
    "memo" TEXT,
    "last_modified" TIMESTAMP(3),
    "date_created" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_order_items" (
    "id" TEXT NOT NULL,
    "transfer_order_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_oracle_id" TEXT,
    "item_name" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "committed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "backordered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipped" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "picked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fulfilled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "from_location_oracle_id" TEXT,
    "from_location_name" TEXT,
    "material_id" TEXT,

    CONSTRAINT "transfer_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfer_orders_oracle_id_key" ON "transfer_orders"("oracle_id");

-- CreateIndex
CREATE INDEX "transfer_orders_warehouse_id_idx" ON "transfer_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "transfer_orders_status_name_idx" ON "transfer_orders"("status_name");

-- CreateIndex
CREATE INDEX "transfer_order_items_transfer_order_id_idx" ON "transfer_order_items"("transfer_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_order_items_transfer_order_id_line_number_key" ON "transfer_order_items"("transfer_order_id", "line_number");

-- AddForeignKey
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_transfer_order_id_fkey" FOREIGN KEY ("transfer_order_id") REFERENCES "transfer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
