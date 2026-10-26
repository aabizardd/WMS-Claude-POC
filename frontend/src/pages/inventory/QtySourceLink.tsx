export type QtySourceType = 'reserved' | 'in-transit';

/**
 * A header Reserved / In Transit quantity that opens, in a new tab, the SO / TO
 * documents behind it. Zero stays plain text: there is nothing to show.
 */
export default function QtySourceLink({
  inventoryId,
  type,
  qty,
}: {
  inventoryId: string;
  type: QtySourceType;
  qty: number;
}) {
  const text = qty.toLocaleString();
  if (qty <= 0) return <>{text}</>;
  return (
    <a
      href={`/admin/inventory/list/${inventoryId}/${type}`}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-brand-700 hover:underline"
      title={type === 'reserved' ? 'See the SO / TO holding this reservation' : 'See the TOs in transit'}
      onClick={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  );
}
