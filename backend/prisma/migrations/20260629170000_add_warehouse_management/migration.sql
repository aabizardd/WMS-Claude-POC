-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" TEXT,
    "parent_name" TEXT,
    "subsidiary_id" TEXT,
    "subsidiary_name" TEXT,
    "location_type" TEXT,
    "location_type_name" TEXT,
    "timezone" TEXT,
    "make_inventory_available" BOOLEAN NOT NULL DEFAULT false,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area_types" (
    "id" TEXT NOT NULL,
    "area_type_name" TEXT NOT NULL,
    "area_type_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "area_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aisles" (
    "id" TEXT NOT NULL,
    "aisle_name" TEXT NOT NULL,
    "aisle_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aisles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelves" (
    "id" TEXT NOT NULL,
    "shelf_label" TEXT NOT NULL,
    "shelf_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bins" (
    "id" TEXT NOT NULL,
    "bin_label" TEXT NOT NULL,
    "bin_code" TEXT NOT NULL,
    "bin_length" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bin_width" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bin_height" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "max_capacity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "warehouse_id" TEXT NOT NULL,
    "aisle_id" TEXT NOT NULL,
    "shelf_id" TEXT NOT NULL,
    "area_type_id" TEXT NOT NULL,
    "dimension_uom_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMP(3),

    CONSTRAINT "bins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_oracle_id_key" ON "warehouses"("oracle_id");

-- CreateIndex
CREATE UNIQUE INDEX "area_types_area_type_code_key" ON "area_types"("area_type_code");

-- CreateIndex
CREATE UNIQUE INDEX "aisles_aisle_code_key" ON "aisles"("aisle_code");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_shelf_code_key" ON "shelves"("shelf_code");

-- CreateIndex
CREATE UNIQUE INDEX "bins_bin_code_key" ON "bins"("bin_code");

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_aisle_id_fkey" FOREIGN KEY ("aisle_id") REFERENCES "aisles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "shelves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_area_type_id_fkey" FOREIGN KEY ("area_type_id") REFERENCES "area_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_dimension_uom_id_fkey" FOREIGN KEY ("dimension_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

