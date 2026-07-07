-- Department master (read-only mirror synced from Oracle)
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "name" TEXT,
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" TEXT,
    "parent_name" TEXT,
    "subsidiary_id" TEXT,
    "subsidiary_name" TEXT,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_oracle_id_key" ON "departments"("oracle_id");
