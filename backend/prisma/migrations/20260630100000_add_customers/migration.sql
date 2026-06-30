-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "oracle_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "company_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "last_modified" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_oracle_id_key" ON "customers"("oracle_id");

