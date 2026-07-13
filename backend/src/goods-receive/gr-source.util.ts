import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Goods Receive is now source-generic (sourceType + sourceDocId). For PIB the
// source document is an MRN (sourceDocId = mrn.id). Until other source types
// (PO / returns / transfer) implement their own line model, these helpers load
// the PIB MRN + items so the existing receive/putaway/discrepancy code keeps
// working unchanged.

export const pibMrnInclude = {
  items: { include: { bin: { select: { id: true, binLabel: true } } } },
} satisfies Prisma.MrnInclude;

export type PibMrn = Prisma.MrnGetPayload<{ include: typeof pibMrnInclude }>;

interface GrSourceRef {
  sourceType: string;
  sourceDocId: string;
}

// Load the MRN (with items) backing a PIB Goods Receive. Returns null for
// non-PIB sources or when the MRN is missing.
export function loadPibMrn(
  prisma: PrismaService,
  gr: GrSourceRef,
): Promise<PibMrn | null> {
  if (gr.sourceType !== 'PIB') return Promise.resolve(null);
  return prisma.mrn.findUnique({
    where: { id: gr.sourceDocId },
    include: pibMrnInclude,
  });
}

// Find the Goods Receive that a given MRN backs (PIB source).
export function findGrForMrn(prisma: PrismaService, mrnId: string) {
  return prisma.goodsReceive.findFirst({
    where: { sourceType: 'PIB', sourceDocId: mrnId },
    select: { id: true, warehouseId: true },
  });
}
