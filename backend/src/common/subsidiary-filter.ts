// Central allow-list of Oracle subsidiary ids that WMS is permitted to display.
// Rows whose subsidiary_id is outside this list (or NULL) are hidden from
// list/table/dropdown queries on every table that has a subsidiary_id column
// (currently: SalesOrder, Vendor, Warehouse — single value; Department, Class —
// comma list).
//
// Warehouse joined the list so only the allowed subsidiary's sites are offered
// and only their rows are listed; a record is still readable by id, so links to
// documents in another subsidiary keep working. User stays unfiltered — it is
// used for scoping and assignment, and a user's own warehouse must resolve even
// when it sits outside the list.
//
// Override via SUBSIDIARY_ALLOWLIST env (comma-separated), else defaults to "6".
const ENV = process.env.SUBSIDIARY_ALLOWLIST;
export const ALLOWED_SUBSIDIARY_IDS: string[] = ENV
  ? ENV.split(',').map((s) => s.trim()).filter(Boolean)
  : ['6'];

// Prisma filter for a SINGLE-value subsidiary_id column (e.g. "6"). NULLs are
// excluded because `in` never matches null.
export function subsidiarySingleFilter(): { in: string[] } {
  return { in: ALLOWED_SUBSIDIARY_IDS };
}

// Prisma OR[] for a COMMA-JOINED subsidiary_id column (e.g. "1, 5, 6, 7"). A row
// matches when any allowed id is a MEMBER of the list (delimiter-aware so "6"
// never matches "16"/"60"; handles optional spaces after commas). NULLs never
// match, so they are hidden. Use as: where.AND = [{ OR: subsidiaryListOr(field) }].
export function subsidiaryListOr(field: string): Record<string, unknown>[] {
  const or: Record<string, unknown>[] = [];
  for (const id of ALLOWED_SUBSIDIARY_IDS) {
    or.push(
      { [field]: id }, // single element, exact
      { [field]: { startsWith: `${id},` } }, // "6,..." / "6, ..."
      { [field]: { endsWith: `,${id}` } }, // "...,6"
      { [field]: { endsWith: `, ${id}` } }, // "..., 6"
      { [field]: { contains: `,${id},` } }, // "...,6,..."
      { [field]: { contains: `, ${id},` } }, // "..., 6,..."
    );
  }
  return or;
}
