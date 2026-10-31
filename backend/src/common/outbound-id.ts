import { Prisma } from '@prisma/client';
import { highestSeq } from './doc-sequence';

type Db = Prisma.TransactionClient;

/** "20261030" for a moment, in WIB. */
function wibDay(at: Date) {
  return new Date(at.getTime() + 7 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Give a Sales / Transfer Order without one its WMS outbound number ("SO ID"
 * on WMS dev): OUT<yyyymmdd>-<nnn>, one daily sequence shared by both kinds.
 * A clash with a number taken in parallel is retried with the next one.
 */
export async function assignOutboundId(db: Db, kind: 'SO' | 'TO', id: string, createdAt: Date) {
  const prefix = `OUT${wibDay(createdAt)}-`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [sos, tos] = await Promise.all([
      db.salesOrder.findMany({ where: { outboundId: { startsWith: prefix } }, select: { outboundId: true } }),
      db.transferOrder.findMany({ where: { outboundId: { startsWith: prefix } }, select: { outboundId: true } }),
    ]);
    const next = highestSeq([...sos, ...tos].map((r) => r.outboundId)) + 1;
    const outboundId = `${prefix}${String(next).padStart(3, '0')}`;
    try {
      if (kind === 'SO') await db.salesOrder.update({ where: { id }, data: { outboundId } });
      else await db.transferOrder.update({ where: { id }, data: { outboundId } });
      return outboundId;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  return null;
}
