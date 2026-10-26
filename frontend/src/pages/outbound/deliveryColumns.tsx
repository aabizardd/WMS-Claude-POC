import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DeliveryRow } from '../../types';
import type { SortState } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';

/**
 * Delivery Plan table columns, shared by the Delivery Plan list and SD
 * Tracking so both read the same. "Transaction ID" is the SO (or TO) number;
 * "SD Number" is the Oracle fulfillment number set by Generate Shipment.
 */
export type DeliveryColumnKey =
  | 'status'
  | 'transaction_id'
  | 'delivery_id'
  | 'sd_number'
  | 'packing_id'
  | 'doc_type'
  | 'warehouse'
  | 'customer'
  | 'created_by'
  | 'created_at'
  | 'updated_by'
  | 'updated_at';

interface DeliveryColumn {
  key: DeliveryColumnKey;
  label: (isTransfer: boolean) => string;
  /** Server sort key; absent where the server cannot order by it. */
  sortCol?: string;
  cell: (d: DeliveryRow, basePath: string) => ReactNode;
}

/** "2026-10-21 13:44", as on the other outbound lists. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Outlined pill: Closed (shipped) green, still Open amber. */
export function deliveryStatusPill(status: string) {
  const cls =
    status === 'Closed'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : 'border-amber-300 bg-amber-50 text-amber-700';
  return (
    <span className={`inline-flex min-w-[5.5rem] justify-center rounded-full border px-3 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export const DELIVERY_COLUMNS: DeliveryColumn[] = [
  { key: 'status', label: () => 'Status', sortCol: 'status', cell: (d) => deliveryStatusPill(d.status) },
  {
    key: 'transaction_id',
    label: () => 'Transaction ID',
    sortCol: 'so_number',
    cell: (d) => d.source_number ?? '-',
  },
  { key: 'delivery_id', label: () => 'Delivery ID', sortCol: 'delivery_code', cell: (d) => d.delivery_id },
  { key: 'sd_number', label: () => 'SD Number', sortCol: 'sdo_id', cell: (d) => d.sdo_id ?? '-' },
  {
    key: 'packing_id',
    label: () => 'Packing ID',
    sortCol: 'packing_id',
    cell: (d, basePath) =>
      d.packing_db_id && d.packing_id ? (
        <Link
          to={`${basePath}/packing/${d.packing_db_id}`}
          className="text-brand-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {d.packing_id}
        </Link>
      ) : (
        d.packing_id ?? '-'
      ),
  },
  { key: 'doc_type', label: () => 'Doc Type', cell: () => 'Delivery Plan' },
  { key: 'warehouse', label: () => 'Warehouse Name', sortCol: 'location', cell: (d) => d.location ?? '-' },
  {
    key: 'customer',
    label: (isTransfer) => (isTransfer ? 'Destination' : 'Customer Name'),
    sortCol: 'customer',
    cell: (d) => d.customer ?? '-',
  },
  { key: 'created_by', label: () => 'Created By', sortCol: 'created_by', cell: (d) => d.created_by ?? '-' },
  {
    key: 'created_at',
    label: () => 'Created At',
    sortCol: 'created_at',
    cell: (d) => formatDateTime(d.created_at),
  },
  { key: 'updated_by', label: () => 'Last Modified By', cell: (d) => d.updated_by ?? '-' },
  {
    key: 'updated_at',
    label: () => 'Last Modified At',
    sortCol: 'updated_at',
    cell: (d) => formatDateTime(d.updated_at),
  },
];

export const DELIVERY_COLUMN_KEYS = DELIVERY_COLUMNS.map((c) => c.key);

export function deliveryColumnOptions(isTransfer: boolean) {
  return DELIVERY_COLUMNS.map((c) => ({ key: c.key, label: c.label(isTransfer) }));
}

export function DeliveryHeaderCells({
  visible,
  isTransfer,
  sort,
  onSort,
}: {
  visible: string[];
  isTransfer: boolean;
  sort: SortState;
  onSort: (col: string) => void;
}) {
  return (
    <>
      {DELIVERY_COLUMNS.filter((c) => visible.includes(c.key)).map((c) =>
        c.sortCol ? (
          <SortableTh
            key={c.key}
            label={c.label(isTransfer)}
            col={c.sortCol}
            sort={sort}
            onSort={onSort}
            pad="px-4"
            className="whitespace-nowrap"
          />
        ) : (
          <th key={c.key} className="whitespace-nowrap px-4 py-3 font-medium">
            {c.label(isTransfer)}
          </th>
        ),
      )}
    </>
  );
}

export function DeliveryRowCells({
  row,
  visible,
  basePath,
}: {
  row: DeliveryRow;
  visible: string[];
  basePath: string;
}) {
  return (
    <>
      {DELIVERY_COLUMNS.filter((c) => visible.includes(c.key)).map((c) => (
        <td
          key={c.key}
          className={`px-4 py-3 text-slate-700 ${
            c.key === 'warehouse' || c.key === 'customer' ? '' : 'whitespace-nowrap'
          }`}
        >
          {c.cell(row, basePath)}
        </td>
      ))}
    </>
  );
}
