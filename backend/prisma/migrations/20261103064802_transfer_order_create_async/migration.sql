-- AlterTable
ALTER TABLE "transfer_orders" ADD COLUMN     "create_payload" JSONB,
ADD COLUMN     "created_by_id" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ORACLE',
ADD COLUMN     "sync_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sync_error" TEXT,
ADD COLUMN     "sync_lock" TEXT,
ADD COLUMN     "sync_started_at" TIMESTAMP(3),
ADD COLUMN     "sync_status" TEXT,
ADD COLUMN     "sync_uncertain" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "oracle_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "transfer_orders_sync_status_idx" ON "transfer_orders"("sync_status");
