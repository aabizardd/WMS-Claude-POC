-- CreateTable
CREATE TABLE "uoms" (
    "id" TEXT NOT NULL,
    "uom_name" TEXT NOT NULL,
    "uom_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_categories" (
    "id" TEXT NOT NULL,
    "material_category_name" TEXT NOT NULL,
    "material_category_code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_types" (
    "id" TEXT NOT NULL,
    "material_type_name" TEXT NOT NULL,
    "material_type_code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "material_name" TEXT NOT NULL,
    "material_code" TEXT NOT NULL,
    "conversion_rate_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT,
    "material_length" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "material_width" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "material_height" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "material_weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "material_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "material_category_id" TEXT NOT NULL,
    "material_type_id" TEXT NOT NULL,
    "primary_uom_id" TEXT,
    "secondary_uom_id" TEXT,
    "weight_uom_id" TEXT,
    "dimension_uom_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uoms_uom_code_key" ON "uoms"("uom_code");

-- CreateIndex
CREATE UNIQUE INDEX "material_categories_material_category_code_key" ON "material_categories"("material_category_code");

-- CreateIndex
CREATE UNIQUE INDEX "material_types_material_type_code_key" ON "material_types"("material_type_code");

-- CreateIndex
CREATE UNIQUE INDEX "materials_material_code_key" ON "materials"("material_code");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_material_type_id_fkey" FOREIGN KEY ("material_type_id") REFERENCES "material_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_primary_uom_id_fkey" FOREIGN KEY ("primary_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_secondary_uom_id_fkey" FOREIGN KEY ("secondary_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_weight_uom_id_fkey" FOREIGN KEY ("weight_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_dimension_uom_id_fkey" FOREIGN KEY ("dimension_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
