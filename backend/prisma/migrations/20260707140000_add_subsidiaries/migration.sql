-- Subsidiary master (read-only mirror synced from Oracle)
CREATE TABLE "subsidiaries" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "name" TEXT,
    "full_name" TEXT,
    "is_delete" BOOLEAN NOT NULL DEFAULT false,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subsidiaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subsidiaries_oracle_id_key" ON "subsidiaries"("oracle_id");
