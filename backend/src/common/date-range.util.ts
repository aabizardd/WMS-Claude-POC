import { BadRequestException } from '@nestjs/common';

/**
 * Parse a "from..to" date range as sent by the DateRangeInput filter
 * (`YYYY-MM-DD[THH:mm]..YYYY-MM-DD[THH:mm]`, either side may be empty) into
 * Prisma bounds. A date without a time covers the whole day.
 */
export function parseDateRange(value: string): { gte?: Date; lte?: Date } {
  const [rawFrom = '', rawTo = ''] = value.split('..');
  const parse = (raw: string, edge: 'start' | 'end'): Date | undefined => {
    const t = raw.trim();
    if (!t) return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(t);
    if (!m) {
      throw new BadRequestException(
        `Date filter must be "YYYY-MM-DD[THH:mm]..YYYY-MM-DD[THH:mm]" (got "${value}")`,
      );
    }
    const hasTime = m[4] !== undefined;
    const hh = hasTime ? Number(m[4]) : edge === 'start' ? 0 : 23;
    const mm = hasTime ? Number(m[5]) : edge === 'start' ? 0 : 59;
    if (hh > 23 || mm > 59) throw new BadRequestException(`"${t}" is not a valid time`);
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      hh,
      mm,
      edge === 'start' ? 0 : 59,
      edge === 'start' ? 0 : 999,
    );
  };
  const gte = parse(rawFrom, 'start');
  const lte = parse(rawTo, 'end');
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}
