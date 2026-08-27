-- FR-IA-14 rule 4 / NFR-IA-L-05: append-only ledger of every stock bucket
-- movement, with the document and person that caused it.
-- Value before a movement = after - delta, per bucket.
CREATE TABLE "stock_movements" (
  "id"               TEXT NOT NULL,
  "inventory_id"     TEXT NOT NULL,
  "bin_id"           TEXT,
  "warehouse_id"     TEXT,
  "material_id"      TEXT,
  "material_code"    TEXT,
  "delta_avail"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "delta_reserved"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "delta_in_transit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "delta_quality"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "delta_qty_issue"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avail_after"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reserved_after"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "in_transit_after" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quality_after"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty_issue_after"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source_module"    TEXT NOT NULL,
  "source_id"        TEXT,
  "source_number"    TEXT,
  "note"             TEXT,
  "actor_id"         INTEGER,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_inventory_id_created_at_idx" ON "stock_movements"("inventory_id", "created_at");
CREATE INDEX "stock_movements_bin_id_idx" ON "stock_movements"("bin_id");
CREATE INDEX "stock_movements_material_id_created_at_idx" ON "stock_movements"("material_id", "created_at");
CREATE INDEX "stock_movements_source_module_source_id_idx" ON "stock_movements"("source_module", "source_id");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_id_fkey"
  FOREIGN KEY ("inventory_id") REFERENCES "inventory_management"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_bin_id_fkey"
  FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
