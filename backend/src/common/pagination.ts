// Standard pagination response metadata, matching the shape used by every
// paginated list endpoint. Pair with a Prisma count + findMany:
//
//   const [total, rows] = await prisma.$transaction([count, findMany]);
//   return { ...paginationMeta(total, page, limit, query), rows: rows.map(...) };
export function paginationMeta(
  total: number,
  page: number,
  limit: number,
  query: { sort_by?: string; sort_order?: string },
) {
  return {
    total_page: Math.ceil(total / limit) || 0,
    total_data: total,
    attributes: {
      page,
      limit,
      sort_by: query.sort_by ?? null,
      sort_order: query.sort_order ?? null,
    },
  };
}
