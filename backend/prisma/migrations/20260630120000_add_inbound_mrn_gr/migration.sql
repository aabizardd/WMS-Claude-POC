-- CreateTable
CREATE TABLE "mrns" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "shipment_number" TEXT,
    "external_doc_number" TEXT,
    "external_id" TEXT,
    "oracle_status" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Closed',
    "expected_shipping_date" TEXT,
    "actual_shipping_date" TEXT,
    "expected_delivery_date" TEXT,
    "actual_delivery_date" TEXT,
    "memo" TEXT,
    "vessel_number" TEXT,
    "bill_of_lading" TEXT,
    "port" TEXT,
    "date_created" TEXT,
    "last_modified" TIMESTAMP(3),
    "receiving_location_id" TEXT,
    "receiving_location_name" TEXT,
    "warehouse_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mrns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrn_items" (
    "id" TEXT NOT NULL,
    "mrn_id" TEXT NOT NULL,
    "po_id" INTEGER,
    "item_id" INTEGER,
    "line_id" INTEGER,
    "po_rate" DOUBLE PRECISION,
    "item_name" TEXT,
    "po_number" TEXT,
    "vendor_id" INTEGER,
    "vendor_name" TEXT,
    "item_description" TEXT,
    "qty_expected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_actual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipment_item_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receiving_location_id" TEXT,
    "receiving_location_name" TEXT,

    CONSTRAINT "mrn_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receives" (
    "id" TEXT NOT NULL,
    "mrn_id" TEXT NOT NULL,
    "gr_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "warehouse_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mrns_oracle_id_key" ON "mrns"("oracle_id");

-- CreateIndex
CREATE UNIQUE INDEX "mrn_items_mrn_id_line_id_key" ON "mrn_items"("mrn_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receives_mrn_id_key" ON "goods_receives"("mrn_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receives_gr_number_key" ON "goods_receives"("gr_number");

-- AddForeignKey
ALTER TABLE "mrns" ADD CONSTRAINT "mrns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrn_items" ADD CONSTRAINT "mrn_items_mrn_id_fkey" FOREIGN KEY ("mrn_id") REFERENCES "mrns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receives" ADD CONSTRAINT "goods_receives_mrn_id_fkey" FOREIGN KEY ("mrn_id") REFERENCES "mrns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receives" ADD CONSTRAINT "goods_receives_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

