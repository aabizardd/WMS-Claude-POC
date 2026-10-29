-- AlterTable
ALTER TABLE "mrns" ADD COLUMN     "aju_number" TEXT;

-- CreateIndex
CREATE INDEX "mrns_aju_number_idx" ON "mrns"("aju_number");

