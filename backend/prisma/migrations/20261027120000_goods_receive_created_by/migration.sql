-- Who generated a Goods Receive (GR List from a TO, GR from a PO).
ALTER TABLE "goods_receives" ADD COLUMN "created_by_id" INTEGER;
ALTER TABLE "goods_receives" ADD CONSTRAINT "goods_receives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
