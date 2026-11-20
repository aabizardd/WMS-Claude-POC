-- TOs created in WMS before the Draft change (20261113090000) kept their Create TO
-- form fields only in the Oracle request body. Copy them onto the columns the
-- list and detail read. Data only; rows that already have a value are left alone.
UPDATE "transfer_orders" t
SET "class_id" = c."id"
FROM "classes" c
WHERE t."class_id" IS NULL
  AND t."create_payload" IS NOT NULL
  AND c."oracle_id" = t."create_payload"->>'class';

UPDATE "transfer_orders" t
SET "department_id" = d."id"
FROM "departments" d
WHERE t."department_id" IS NULL
  AND t."create_payload" IS NOT NULL
  AND d."oracle_id" = t."create_payload"->>'department';

UPDATE "transfer_orders"
SET "note_approval" = NULLIF(BTRIM("create_payload"->>'note_approval'), '')
WHERE "note_approval" IS NULL
  AND "create_payload" IS NOT NULL
  AND NULLIF(BTRIM("create_payload"->>'note_approval'), '') IS NOT NULL;
