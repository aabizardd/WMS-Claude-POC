-- Generic Goods Receive source (PIB / PO / customer return / transfer return).
-- Data-preserving: existing rows are PIB, so source_doc_id = old mrn_id.

-- CreateEnum
CREATE TYPE "GoodsReceiveSource" AS ENUM ('PIB', 'PO', 'CUSTOMER_RETURN', 'TRANSFER_RETURN');

-- AlterTable: add new generic columns (source_doc_id nullable for backfill)
ALTER TABLE "goods_receives"
  ADD COLUMN "source_type" "GoodsReceiveSource" NOT NULL DEFAULT 'PIB',
  ADD COLUMN "source_doc_id" TEXT,
  ADD COLUMN "source_doc_number" TEXT;

-- Backfill from the existing MRN link (all current GRs are PIB).
UPDATE "goods_receives" gr
SET "source_doc_id" = gr."mrn_id",
    "source_doc_number" = m."shipment_number"
FROM "mrns" m
WHERE m."id" = gr."mrn_id";

-- Any GR without a matching MRN (should be none) keeps its mrn_id as source.
UPDATE "goods_receives"
SET "source_doc_id" = "mrn_id"
WHERE "source_doc_id" IS NULL;

-- Enforce NOT NULL now that data is backfilled.
ALTER TABLE "goods_receives" ALTER COLUMN "source_doc_id" SET NOT NULL;

-- Drop the old MRN-specific link (FK + unique index + column).
ALTER TABLE "goods_receives" DROP CONSTRAINT IF EXISTS "goods_receives_mrn_id_fkey";
DROP INDEX IF EXISTS "goods_receives_mrn_id_key";
ALTER TABLE "goods_receives" DROP COLUMN "mrn_id";

-- New generic constraints/indexes.
CREATE UNIQUE INDEX "goods_receives_source_type_source_doc_id_key" ON "goods_receives" ("source_type", "source_doc_id");
CREATE INDEX "goods_receives_source_doc_id_idx" ON "goods_receives" ("source_doc_id");
