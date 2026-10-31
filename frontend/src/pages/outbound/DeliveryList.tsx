import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { downloadFile } from '../../lib/download';
import type {
  DeliveryFilter,
  DeliveryFilterField,
  DeliveryItemRow,
  DeliveryRow,
  Paginated,
} from '../../types';
import { useSort } from '../../hooks/useSort';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { TrashIcon } from '../../components/icons';
import { deleteOutboundDoc } from './outboundDelete';
import RowActionMenu from '../../components/RowActionMenu';
import TablePager from '../../components/TablePager';
import MultiValueInput from '../../components/MultiValueInput';
import { ExportIcon } from '../../components/ToolbarMenu';
import {
  AccordionPanelRow,
  DetailIcon,
  ExpandAllButton,
  ExtraFiltersModal,
  FilterField,
  ListFilterPanel,
  ListHeader,
  RefreshButton,
  RowExpandCell,
  TotalCards,
  expandableRowClass,
  stickyActionsCellClass,
} from '../../components/ListView';
import ColumnSettings, { useColumnVisibility } from '../../components/ColumnSettings';
import {
  DELIVERY_COLUMN_KEYS,
  DeliveryHeaderCells,
  DeliveryRowCells,
  deliveryColumnOptions,
} from './deliveryColumns';
import DeliveryItemsTable from './DeliveryItemsTable';

/** Server-side cap on values within one filter. */
const MAX_VALUES = 10;
/**
 * Without an item filter an open delivery shows at most this many lines and
 * then points at the detail page.
 */
const ITEM_PREVIEW = 10;


interface FieldDef {
  value: DeliveryFilterField;
  label: string;
  /** Every Delivery Plan filter is free text. */
  kind: 'text';
  /** Matched against the delivery's lines rather than its header. */
  item?: true;
}

interface FilterSet {
  primary: FieldDef[];
  extra: FieldDef[];
}

/**
 * The filters per source. The first three sit above the table and search as
 * they change; the rest live behind "Additional filters".
 */
const SO_FILTERS: FilterSet = {
  primary: [
    { value: 'material_code', label: 'Part Number', kind: 'text', item: true },
    { value: 'warehouse_name', label: 'Warehouse', kind: 'text' },
    { value: 'sdo_id', label: 'SD Number', kind: 'text' },
  ],
  extra: [
    { value: 'tran_id', label: 'Transaction ID', kind: 'text' },
    { value: 'material_name', label: 'Material Name', kind: 'text', item: true },
    { value: 'customer_name', label: 'Customer Name', kind: 'text' },
    { value: 'oracle_id', label: 'ERP Doc ID', kind: 'text' },
    { value: 'packing_code', label: 'Packing ID', kind: 'text' },
    { value: 'created_by_name', label: 'Created By', kind: 'text' },
  ],
};

const TO_FILTERS: FilterSet = {
  primary: [
    { value: 'material_code', label: 'Part Number', kind: 'text', item: true },
    { value: 'warehouse_name', label: 'Origin Warehouse', kind: 'text' },
    { value: 'sdo_id', label: 'SD Number', kind: 'text' },
  ],
  extra: [
    { value: 'to_warehouse_name', label: 'Destination Warehouse', kind: 'text' },
    { value: 'tran_id', label: 'Transaction ID', kind: 'text' },
    { value: 'material_name', label: 'Material Name', kind: 'text', item: true },
    { value: 'oracle_id', label: 'ERP Doc ID', kind: 'text' },
    { value: 'packing_code', label: 'Packing ID', kind: 'text' },
    { value: 'created_by_name', label: 'Created By', kind: 'text' },
  ],
};

type Draft = Record<string, string[]>;

/** Does this line match one item filter? Mirrors the server (values OR-ed). */
function itemMatches(it: DeliveryItemRow, f: DeliveryFilter): boolean {
  return f.values.some((raw) => {
    const v = raw.trim().toLowerCase();
    if (!v) return false;
    const has = (s: string | null) => !!s && s.toLowerCase().includes(v);
    if (f.field === 'material_code') return has(it.material_code);
    if (f.field === 'material_name') return has(it.material_name);
    return true;
  });
}

interface DeliveryListProps {
  source?: 'SALES_ORDER' | 'TRANSFER_ORDER';
  basePath?: string;
}

/**
 * Delivery Plan: delivery documents generated from Packing, every status, for
 * Sales Orders or Transfer Orders. Loads at once with every delivery's lines
 * open, and is filtered the same way as the Inventory and Transfer Order lists.
 */
export default function DeliveryList({
  source,
  basePath = '/admin/outbound/sales-order',
}: DeliveryListProps = {}) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = useAuth();
  const canDelete = has('delivery:delete');
  const isTransfer = source === 'TRANSFER_ORDER';
  const { primary: PRIMARY_FIELDS, extra: EXTRA_FIELDS } = isTransfer ? TO_FILTERS : SO_FILTERS;
  const FILTER_FIELDS = [...PRIMARY_FIELDS, ...EXTRA_FIELDS];
  const fieldLabel = (f: DeliveryFilterField) => FILTER_FIELDS.find((x) => x.value === f)?.label ?? f;
  const emptyDraft = (): Draft => Object.fromEntries(FILTER_FIELDS.map((f) => [f.value, []]));
  const draftFrom = (filters: DeliveryFilter[]): Draft => {
    const d = emptyDraft();
    for (const f of filters) d[f.field] = f.values;
    return d;
  };

  const [searchParams, setSearchParams] = useSearchParams();
  // Read once on mount; from then on the URL is written, not watched.
  const [initial] = useState(() => {
    let filters: DeliveryFilter[] = [];
    try {
      const parsed: unknown = JSON.parse(searchParams.get('filters') ?? '[]');
      const known = new Set(FILTER_FIELDS.map((f) => f.value));
      // A hand-edited URL must not be able to break the page.
      if (Array.isArray(parsed)) {
        filters = parsed.flatMap((f): DeliveryFilter[] => {
          const field = (f as DeliveryFilter)?.field;
          const values = (f as DeliveryFilter)?.values;
          if (!known.has(field) || !Array.isArray(values)) return [];
          const clean = values.filter((v): v is string => typeof v === 'string' && !!v.trim());
          return clean.length ? [{ field, values: clean }] : [];
        });
      }
    } catch {
      filters = [];
    }
    return { filters };
  });

  const [data, setData] = useState<(Paginated<DeliveryRow> & { totals?: { qty: number } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);

  // Draft values are what the user edits; `applied` is what the server was asked for.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial.filters));
  const [applied, setApplied] = useState<DeliveryFilter[]>(initial.filters);
  const [extraOpen, setExtraOpen] = useState(false);

  // Every delivery's lines are open by default; this holds the ones closed by hand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { visible, setVisible } = useColumnVisibility('wms.deliveryPlan.columns.v2', DELIVERY_COLUMN_KEYS);
  // Expand + No + the chosen columns + Actions.
  const colCount = visible.length + 3;

  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };

  const appliedKey = JSON.stringify(applied);
  const [exporting, setExporting] = useState(false);

  /**
   * Sales Order plans only: the shipped plans the filters match with their SO
   * lines — what each SO asked for and what was delivered on which SD.
   */
  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    toast.info('Preparing the export…');
    try {
      await downloadFile(
        '/delivery/export',
        { source: 'SALES_ORDER', status: 'all', filters: applied.length ? appliedKey : undefined },
        'delivery_plan_sales_order_export.xlsx',
      );
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<Paginated<DeliveryRow> & { totals?: { qty: number } }>('/delivery', {
        params: {
          page,
          limit: pageSize,
          source: source || undefined,
          status: 'all',
          filters: applied.length ? appliedKey : undefined,
          include_items: 'true',
          ...params(),
        },
      })
      .then((r) => active && setData(r.data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, source, appliedKey, sort.sortBy, sort.order, reloadKey]);

  // Keep the filters in the URL so a refresh or a shared link restores them.
  useEffect(() => {
    const next = new URLSearchParams();
    if (applied.length) next.set('filters', appliedKey);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const itemFilters = applied.filter((f) => FILTER_FIELDS.some((x) => x.value === f.field && x.item));

  /** Search with a set of field values (empty fields are dropped). */
  function runSearch(values: Draft) {
    const next = FILTER_FIELDS.map((f) => ({
      field: f.value,
      values: (values[f.value] ?? []).map((v) => v.trim()).filter(Boolean),
    })).filter((f) => f.values.length);
    setPage(1);
    setApplied(next);
  }

  /** The three fields outside the modal search as soon as they change. */
  function changePrimary(field: DeliveryFilterField, values: string[]) {
    const next = { ...draft, [field]: values };
    setDraft(next);
    runSearch(next);
  }

  /** The modal's fields as last applied — what a closed modal falls back to. */
  function appliedExtras(): Draft {
    const fromApplied = draftFrom(applied);
    return Object.fromEntries(EXTRA_FIELDS.map((f) => [f.value, fromApplied[f.value] ?? []]));
  }

  function applyExtras() {
    runSearch(draft);
    setExtraOpen(false);
  }

  /** Closing the modal without Apply drops its unapplied edits. */
  function closeExtras() {
    setDraft((d) => ({ ...d, ...appliedExtras() }));
    setExtraOpen(false);
  }

  /** Reset empties the modal's fields; nothing is searched until Apply. */
  function resetExtras() {
    setDraft((d) => ({ ...d, ...Object.fromEntries(EXTRA_FIELDS.map((f) => [f.value, []])) }));
  }

  function clearFilters() {
    setDraft(emptyDraft());
    setApplied([]);
    setPage(1);
  }


  const extraCount = applied.filter((f) => EXTRA_FIELDS.some((x) => x.value === f.field)).length;

  function renderField(f: FieldDef, onChange: (v: string[]) => void) {
    const values = draft[f.value] ?? [];
    return (
      <MultiValueInput
        values={values}
        onChange={onChange}
        max={MAX_VALUES}
        placeholder={`${f.label} — type and press Enter…`}
      />
    );
  }

  // ----- accordion -----

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const anyOpen = rows.some((r) => !collapsed.has(r.id));

  function toggleRow(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(anyOpen ? new Set(rows.map((r) => r.id)) : new Set());
  }

  return (
    <div className="card overflow-hidden">
      <div className="space-y-4 p-5 pb-4">
        <ListHeader
          title="Delivery Plan"
          subtitle="Schedule and assign deliveries to drivers"
          menu={[
            {
              label: exporting ? 'Exporting…' : 'Export',
              icon: <ExportIcon />,
              // The SO × delivery export; Transfer Order plans have none yet.
              onClick: isTransfer ? () => toast.info('Export is not available yet.') : exportExcel,
            },
          ]}
        />

        <ListFilterPanel
          extraCount={extraCount}
          onOpenExtras={() => {
            setDraft((d) => ({ ...d, ...appliedExtras() }));
            setExtraOpen(true);
          }}
          onClear={applied.length > 0 ? clearFilters : undefined}
          chips={applied.map((f) => ({
            label: fieldLabel(f.field),
            value: f.values.join(' or '),
          }))}
          chipsNote={itemFilters.length > 0 ? 'open deliveries show only the matching materials' : undefined}
          toolbar={
            <>
              <ExpandAllButton anyOpen={anyOpen} onClick={toggleAll} disabled={rows.length === 0} />
              <ColumnSettings columns={deliveryColumnOptions(isTransfer)} visible={visible} onApply={setVisible} />
              <RefreshButton onClick={() => setReloadKey((k) => k + 1)} spinning={loading} />
            </>
          }
        >
          {PRIMARY_FIELDS.map((f) => (
            <FilterField key={f.value} label={f.label}>
              {renderField(f, (v) => changePrimary(f.value, v))}
            </FilterField>
          ))}
        </ListFilterPanel>
      </div>

      {/* Nothing here searches until Apply, which runs it with the fields above. */}
      <ExtraFiltersModal open={extraOpen} onClose={closeExtras} onReset={resetExtras} onApply={applyExtras}>
        {EXTRA_FIELDS.map((f) => (
          <FilterField key={f.value} label={f.label}>
            {renderField(f, (v) => setDraft((d) => ({ ...d, [f.value]: v })))}
          </FilterField>
        ))}
      </ExtraFiltersModal>

      {/* Quantity of every matching delivery, as on the other lists. */}
      {data?.totals && <TotalCards items={[['Quantity', data.totals.qty]]} />}

      <div className="mx-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr className="[&>th]:font-medium [&_button]:normal-case [&_button]:tracking-normal">
                <th className="w-10 px-2 py-3" aria-label="Expand" />
                <th className="px-4 py-3 font-medium">No</th>
                <DeliveryHeaderCells visible={visible} isTransfer={isTransfer} sort={sort} onSort={onSort} />
                <th className="sticky right-0 bg-slate-50 px-4 py-3 text-center font-medium shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && !data ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((d, i) => {
                  const open = !collapsed.has(d.id);
                  const all = d.items ?? [];
                  const matching = itemFilters.length
                    ? all.filter((it) => itemFilters.every((f) => itemMatches(it, f)))
                    : all;
                  // An item filter shows every match; otherwise only the first few.
                  const shown = itemFilters.length ? matching : matching.slice(0, ITEM_PREVIEW);
                  const detailPath = `${basePath}/delivery/${d.id}`;
                  return [
                    <tr key={d.id} className={expandableRowClass(open, loading)} onClick={() => toggleRow(d.id)}>
                      <RowExpandCell open={open} onToggle={() => toggleRow(d.id)} noun="materials" />
                      <td className="px-4 py-3 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <DeliveryRowCells row={d} visible={visible} basePath={basePath} />
                      <td className={stickyActionsCellClass(open)} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          actions={[
                            { label: 'Detail', icon: <DetailIcon />, onClick: () => navigate(detailPath) },
                            // Only a plan not shipped yet can be deleted.
                            ...(canDelete && d.status === 'Open' && !d.sdo_id
                              ? [
                                  {
                                    label: 'Delete',
                                    icon: <TrashIcon />,
                                    onClick: async () => {
                                      if (await deleteOutboundDoc('delivery', d.id, d.delivery_id, confirm, toast))
                                        setReloadKey((k) => k + 1);
                                    },
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>,

                    open && (
                      <AccordionPanelRow
                        key={`${d.id}-items`}
                        colSpan={colCount}
                        title="Material List"
                        noun="materials"
                        total={all.length}
                        matching={matching.length}
                        filtered={itemFilters.length > 0}
                        shown={shown.length}
                        detailPath={detailPath}
                      >
                        <DeliveryItemsTable
                          items={shown}
                          packingId={d.packing_id}
                          emptyText={
                            itemFilters.length
                              ? 'No material on this delivery matches the filter.'
                              : 'This delivery has no materials.'
                          }
                        />
                      </AccordionPanelRow>
                    ),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-slate-400">
                    {applied.length > 0 ? 'No delivery matches the filters.' : 'No delivery documents yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="px-1 pb-1 pt-2">
        <TablePager
          page={page}
          pageSize={pageSize}
          total={data?.total_data ?? 0}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
