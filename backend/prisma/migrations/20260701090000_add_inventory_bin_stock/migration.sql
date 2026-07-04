-- CreateTable
CREATE TABLE "inventory_bin_stocks" (
    "id" TEXT NOT NULL,
    "inventory_id" TEXT NOT NULL,
    "bin_id" TEXT,
    "reserved_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avail_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "in_transit_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_issue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty_issue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_bin_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_bin_stocks_inventory_id_bin_id_key" ON "inventory_bin_stocks"("inventory_id", "bin_id");

-- AddForeignKey
ALTER TABLE "inventory_bin_stocks" ADD CONSTRAINT "inventory_bin_stocks_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_management"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_bin_stocks" ADD CONSTRAINT "inventory_bin_stocks_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill bin stocks by aggregating existing inventory batches per (inventory, bin)
INSERT INTO "inventory_bin_stocks"
    ("id", "inventory_id", "bin_id", "reserved_qty", "avail_qty", "in_transit_qty", "quality_issue", "qty_issue", "created_at", "updated_at")
SELECT gen_random_uuid(), "inventory_id", "bin_id",
       SUM("reserved_qty"), SUM("avail_qty"), SUM("in_transit_qty"), SUM("quality_issue"), SUM("qty_issue"),
       now(), now()
FROM "inventory_batches"
GROUP BY "inventory_id", "bin_id";
