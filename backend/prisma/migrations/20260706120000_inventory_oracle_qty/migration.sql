-- Oracle-mirrored header quantities on inventory_management
ALTER TABLE "inventory_management"
  ADD COLUMN "qty_committed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "qty_on_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "qty_back_order" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Flag for auto-created virtual bins (hold Oracle available qty per warehouse)
ALTER TABLE "bins"
  ADD COLUMN "is_virtual" BOOLEAN NOT NULL DEFAULT false;
