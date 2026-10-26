-- Customer on the Sales Delivery header, picked from the Customer master.
-- Nullable, so the documents created before this column keep working.
ALTER TABLE "sales_deliveries" ADD COLUMN "customer_id" TEXT;

CREATE INDEX "sales_deliveries_customer_id_idx" ON "sales_deliveries"("customer_id");

ALTER TABLE "sales_deliveries"
  ADD CONSTRAINT "sales_deliveries_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
