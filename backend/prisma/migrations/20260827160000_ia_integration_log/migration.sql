-- FR-IA-13 rule 8 / FR-IA-16 rule 6: keep the full request and response of every
-- Oracle call per document so a failed or disputed adjustment can be reconciled.
CREATE TABLE "inventory_adjustment_integration_logs" (
  "id"            TEXT NOT NULL,
  "adjustment_id" TEXT NOT NULL,
  "operation"     TEXT NOT NULL,
  "endpoint"      TEXT NOT NULL,
  "request"       JSONB NOT NULL,
  "response"      JSONB,
  "http_status"   INTEGER,
  "ok"            BOOLEAN NOT NULL DEFAULT false,
  "error"         TEXT,
  "duration_ms"   INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_adjustment_integration_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_adjustment_integration_logs_adjustment_id_idx"
  ON "inventory_adjustment_integration_logs"("adjustment_id");
ALTER TABLE "inventory_adjustment_integration_logs"
  ADD CONSTRAINT "inventory_adjustment_integration_logs_adjustment_id_fkey"
  FOREIGN KEY ("adjustment_id") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
