-- AlterTable
ALTER TABLE "mrn_items" ADD COLUMN     "bin_id" TEXT;

-- AddForeignKey
ALTER TABLE "mrn_items" ADD CONSTRAINT "mrn_items_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
