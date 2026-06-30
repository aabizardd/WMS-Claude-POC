-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "company_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "terms" TEXT,
    "terms_display" TEXT,
    "subsidiary_id" TEXT,
    "subsidiary_display" TEXT,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_oracle_id_key" ON "vendors"("oracle_id");

