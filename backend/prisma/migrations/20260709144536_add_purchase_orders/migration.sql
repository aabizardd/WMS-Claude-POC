-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "po_number" TEXT,
    "po_date" TEXT,
    "po_status" TEXT,
    "po_status_label" TEXT,
    "memo" TEXT,
    "vendor_id" INTEGER,
    "vendor_name" TEXT,
    "currency_id" INTEGER,
    "currency_symbol" TEXT,
    "approval_status" INTEGER,
    "approval_status_display" TEXT,
    "subsidiary_id" TEXT,
    "subsidiary_display" TEXT,
    "class_display" TEXT,
    "department_display" TEXT,
    "location_oracle_id" TEXT,
    "location_name" TEXT,
    "warehouse_id" TEXT,
    "created_by_netsuite" TEXT,
    "date_created" TEXT,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "item_oracle_id" TEXT,
    "item_display" TEXT,
    "item_type" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "committed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "backordered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity_received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity_billed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location_oracle_id" TEXT,
    "location_name" TEXT,
    "department_display" TEXT,
    "class_display" TEXT,
    "inbound_shipment_number" TEXT,
    "inbound_shipment_line_id" INTEGER,
    "material_id" TEXT,
    "qty_actual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bin_id" TEXT,
    "inventoried_at" TIMESTAMP(3),

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_oracle_id_key" ON "purchase_orders"("oracle_id");

-- CreateIndex
CREATE INDEX "purchase_orders_warehouse_id_idx" ON "purchase_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_orders_po_status_idx" ON "purchase_orders"("po_status");

-- CreateIndex
CREATE INDEX "purchase_orders_subsidiary_id_idx" ON "purchase_orders"("subsidiary_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_id_key" ON "purchase_order_lines"("purchase_order_id", "line_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
