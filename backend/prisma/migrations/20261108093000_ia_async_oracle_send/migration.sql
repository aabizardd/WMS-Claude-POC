-- Inventory Adjustment: the Oracle post runs in the background.
ALTER TABLE "inventory_adjustments" ADD COLUMN "oracle_sending_at" TIMESTAMP(3),
ADD COLUMN "oracle_send_lock" TEXT;
