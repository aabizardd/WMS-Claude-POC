import { Prisma } from '@prisma/client';

/**
 * Bins whose label contains "KIT" hold stock reserved for kitting: it is on
 * hand but frozen, so it is reported as Freeze Qty instead of Available and
 * cannot be picked, adjusted or transferred out.
 *
 * The marker is configurable because it is a label convention, not a schema
 * concept — override with FROZEN_BIN_LABEL.
 */
export const FROZEN_BIN_MARKER = (
  process.env.FROZEN_BIN_LABEL ?? 'KIT'
).trim();

/** Is this bin label a frozen (kitting) bin? */
export function isFrozenBinLabel(label: string | null | undefined): boolean {
  if (!label || !FROZEN_BIN_MARKER) return false;
  return label.toUpperCase().includes(FROZEN_BIN_MARKER.toUpperCase());
}

/**
 * Prisma predicate on InventoryBinStock selecting the bins that may still be
 * used. Stock with no bin at all stays usable — it is not frozen, just
 * unplaced.
 */
export function usableBinStockWhere(): Prisma.InventoryBinStockWhereInput {
  if (!FROZEN_BIN_MARKER) return {};
  return {
    NOT: {
      bin: { binLabel: { contains: FROZEN_BIN_MARKER, mode: 'insensitive' } },
    },
  };
}
