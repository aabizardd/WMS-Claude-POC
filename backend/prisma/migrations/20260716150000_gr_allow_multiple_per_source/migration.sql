-- A PO can be received partially several times → several GRs per source doc.
-- Replace the unique constraint with a plain index. (PIB one-GR-per-MRN is
-- enforced in code via a findFirst existence check.)
DROP INDEX "goods_receives_source_type_source_doc_id_key";
CREATE INDEX "goods_receives_source_type_source_doc_id_idx" ON "goods_receives"("source_type", "source_doc_id");
