-- Sales Delivery status is now Success | Failed.
-- Rename rather than drop/recreate so existing documents keep their row and
-- move from Submitted to Success in place.
ALTER TYPE "SalesDeliveryStatus" RENAME VALUE 'Submitted' TO 'Success';
ALTER TYPE "SalesDeliveryStatus" ADD VALUE 'Failed';

ALTER TABLE "sales_deliveries" ALTER COLUMN "status" SET DEFAULT 'Success';
