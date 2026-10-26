-- AlterTable
ALTER TABLE "goods_receive_items" ADD COLUMN     "qty_actual" DOUBLE PRECISION NOT NULL DEFAULT 0;


-- TO GRs received before this column existed: what they received is `qty`.
UPDATE "goods_receive_items" gri
SET "qty_actual" = gri."qty"
FROM "goods_receives" gr
WHERE gr."id" = gri."goods_receive_id" AND gr."source_type" = 'TO' AND gr."status" <> 'Open';
