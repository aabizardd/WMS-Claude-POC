-- Sales Return lives in the same table as Sales Delivery, told apart by type.
CREATE TYPE "SalesDeliveryDocumentType" AS ENUM ('SalesDelivery', 'SalesReturn');

ALTER TABLE "sales_deliveries"
  ADD COLUMN "document_type" "SalesDeliveryDocumentType" NOT NULL DEFAULT 'SalesDelivery',
  ADD COLUMN "source_delivery_id" TEXT;

CREATE INDEX "sales_deliveries_document_type_idx" ON "sales_deliveries"("document_type");
CREATE INDEX "sales_deliveries_source_delivery_id_idx" ON "sales_deliveries"("source_delivery_id");

-- A return points at the delivery it reverses; deleting that delivery leaves
-- the return in place with a null link rather than cascading it away.
ALTER TABLE "sales_deliveries"
  ADD CONSTRAINT "sales_deliveries_source_delivery_id_fkey"
  FOREIGN KEY ("source_delivery_id") REFERENCES "sales_deliveries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
