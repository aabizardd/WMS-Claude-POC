-- Roles can be set inactive; every existing role stays active.
ALTER TABLE "roles" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
