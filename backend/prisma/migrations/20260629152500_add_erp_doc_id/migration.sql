-- DropForeignKey
ALTER TABLE "materials" DROP CONSTRAINT "materials_material_category_id_fkey";

-- DropForeignKey
ALTER TABLE "materials" DROP CONSTRAINT "materials_material_type_id_fkey";

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "erp_doc_id" TEXT,
ALTER COLUMN "material_category_id" DROP NOT NULL,
ALTER COLUMN "material_type_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "materials_erp_doc_id_key" ON "materials"("erp_doc_id");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_material_type_id_fkey" FOREIGN KEY ("material_type_id") REFERENCES "material_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
