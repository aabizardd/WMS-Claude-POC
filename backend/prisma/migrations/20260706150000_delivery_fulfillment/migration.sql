-- Oracle Item Fulfillment result stored on the delivery (set on Generate Shipment)
ALTER TABLE "deliveries"
  ADD COLUMN "oracle_fulfillment_id" INTEGER,
  ADD COLUMN "oracle_local_id" INTEGER;
