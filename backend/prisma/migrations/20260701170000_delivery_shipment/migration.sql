-- AlterEnum: delivery can be Closed after shipment
ALTER TYPE "DeliveryDocStatus" ADD VALUE IF NOT EXISTS 'Closed';

-- AlterTable: SDO ID moves onto the delivery (set at Generate Shipment)
ALTER TABLE "deliveries" ADD COLUMN "sdo_id" TEXT;
CREATE UNIQUE INDEX "deliveries_sdo_id_key" ON "deliveries"("sdo_id");

-- Drop SDO ID from picking (moved to delivery). Dropping the column also drops
-- its unique index.
ALTER TABLE "pickings" DROP COLUMN "sdo_id";
