/**
 * Footer pager for a table: rows-per-page select, the "1-10 of 550" range, and
 * Previous / numbered pages (with … gaps) / Next.
 */
export default function TablePager({
  page,
  pageSize,
  total,
  pageSizes = [5, 10, 20, 50, 100],
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  pageSizes?: number[];
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
      <div className="flex items-center gap-2">
        <span>Showing</span>
        <select
          className="input w-auto py-1 text-sm"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span>
          {start}-{end} of {total.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded-md px-2 py-1 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ‹ Previous
        </button>
        {pageItems(page, pageCount).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`min-w-[30px] rounded-md border px-2 py-1 ${
                p === page
                  ? 'border-slate-300 bg-white font-semibold text-slate-800 shadow-sm'
                  : 'border-transparent hover:bg-slate-100'
              }`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="rounded-md px-2 py-1 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

/** First, last, and the pages around the current one; gaps become "…". */
function pageItems(page: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, page - 1, page, page + 1]);
  const out: (number | '…')[] = [];
  for (let p = 1; p <= count; p++) {
    if (keep.has(p)) out.push(p);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}
