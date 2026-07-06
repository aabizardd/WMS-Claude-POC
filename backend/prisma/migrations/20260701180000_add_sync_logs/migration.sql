-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('success', 'partial', 'failed');

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "last_modified" TEXT,
    "upserted" INTEGER,
    "failed" INTEGER,
    "total_records" INTEGER,
    "message" TEXT,
    "duration_ms" INTEGER,
    "retried_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_logs_status_created_at_idx" ON "sync_logs"("status", "created_at");
