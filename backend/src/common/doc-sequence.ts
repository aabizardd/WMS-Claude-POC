/**
 * Highest running number among codes like "PICK-20261026-007" (→ 7).
 *
 * Document numbers are "<PREFIX>-<yyyymmdd>-<nnn>". Counting today's rows to
 * get the next number breaks as soon as one is deleted (the count drops and
 * the next number is already taken), so the next number is always derived
 * from the highest one in use.
 */
export function highestSeq(codes: (string | null)[]): number {
  let max = 0;
  for (const c of codes) {
    const n = Number(c?.split('-').pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
