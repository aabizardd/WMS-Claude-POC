-- Inventory Sales: posted to Oracle (inventory/transfer) in the background.
ALTER TYPE "SalesDeliveryStatus" ADD VALUE 'Syncing' BEFORE 'Success';

ALTER TABLE "sales_deliveries" ADD COLUMN "transaction_id" TEXT,
ADD COLUMN "oracle_error" TEXT,
ADD COLUMN "oracle_send_lock" TEXT;
