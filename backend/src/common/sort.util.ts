export type SortDir = 'asc' | 'desc';

/**
 * Build a Prisma `orderBy` from `sort_by` / `sort_order` using a whitelist that
 * maps snake_case column keys to an orderBy builder. Falls back to the provided
 * default when `sort_by` is absent or not allowlisted (so pagination always has
 * a stable order). Builders receive the direction so nested relations work, e.g.
 *   { material_name: (dir) => ({ material: { materialName: dir } }) }
 */
export function buildOrderBy<T>(
  sortBy: string | undefined,
  sortOrder: string | undefined,
  allowed: Record<string, (dir: SortDir) => T>,
  fallback: T,
): T {
  if (!sortBy) return fallback;
  const build = allowed[sortBy];
  if (!build) return fallback;
  const dir: SortDir = sortOrder === 'asc' ? 'asc' : 'desc';
  return build(dir);
}
