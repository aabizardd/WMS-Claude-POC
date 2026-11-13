-- AlterTable: Create TO form fields kept for a Draft and for Clone.
ALTER TABLE "transfer_orders" ADD COLUMN "class_id" TEXT,
ADD COLUMN "department_id" TEXT,
ADD COLUMN "note_approval" TEXT;
