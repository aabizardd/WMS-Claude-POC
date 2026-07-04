import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  Aisle,
  AreaType,
  Bin,
  Shelf,
  Uom,
  WarehouseOption,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import SearchableSelect from '../../components/SearchableSelect';
import FormField, { requiredErrors } from '../../components/form/FormField';

interface FormState {
  binLabel: string;
  binCode: string;
  warehouseId: string;
  aisleId: string;
  shelfId: string;
  areaTypeId: string;
  dimensionUomId: string;
  binLength: number;
  binWidth: number;
  binHeight: number;
  maxCapacity: number;
  isActive: boolean;
}

const emptyForm: FormState = {
  binLabel: '',
  binCode: '',
  warehouseId: '',
  aisleId: '',
  shelfId: '',
  areaTypeId: '',
  dimensionUomId: '',
  binLength: 0,
  binWidth: 0,
  binHeight: 0,
  maxCapacity: 0,
  isActive: true,
};

export default function BinFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const { has } = useAuth();
  const canManage = isNew ? has('bins:create') : has('bins:update');
  const viewOnly = !canManage;

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [aisles, setAisles] = useState<Aisle[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [areaTypes, setAreaTypes] = useState<AreaType[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    const reqs: Promise<unknown>[] = [
      api.get<WarehouseOption[]>('/warehouses/options'),
      api.get<Aisle[]>('/aisles/options'),
      api.get<Shelf[]>('/shelves/options'),
      api.get<AreaType[]>('/area-types/options'),
      api.get<Uom[]>('/uoms/options'),
    ];
    if (!isNew) reqs.push(api.get<Bin>(`/bins/${id}`));

    Promise.all(reqs)
      .then((res) => {
        if (!active) return;
        setWarehouses((res[0] as { data: WarehouseOption[] }).data);
        setAisles((res[1] as { data: Aisle[] }).data);
        setShelves((res[2] as { data: Shelf[] }).data);
        setAreaTypes((res[3] as { data: AreaType[] }).data);
        setUoms((res[4] as { data: Uom[] }).data);
        if (!isNew) {
          const b = (res[5] as { data: Bin }).data;
          setForm({
            binLabel: b.bin_label,
            binCode: b.bin_code,
            warehouseId: b.warehouse_id,
            aisleId: b.aisle_id,
            shelfId: b.shelf_id,
            areaTypeId: b.area_type_id,
            dimensionUomId: b.dimension_uom_id ?? '',
            binLength: b.bin_length,
            binWidth: b.bin_width,
            binHeight: b.bin_height,
            maxCapacity: b.max_capacity,
            isActive: b.is_active,
          });
        }
      })
      .catch(() => active && setLoadError('Failed to load.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, isNew]);

  const set = (patch: Partial<FormState>) => {
    setForm({ ...form, ...patch });
    setFieldErrors((p) => {
      const next = { ...p };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs = requiredErrors([
      ['binLabel', form.binLabel, 'Bin label is required'],
      ['binCode', form.binCode, 'Bin code is required'],
      ['warehouseId', form.warehouseId, 'Warehouse is required'],
      ['areaTypeId', form.areaTypeId, 'Area type is required'],
      ['aisleId', form.aisleId, 'Aisle is required'],
      ['shelfId', form.shelfId, 'Shelf is required'],
    ]);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    const payload = {
      binLabel: form.binLabel,
      binCode: form.binCode,
      warehouseId: form.warehouseId,
      aisleId: form.aisleId,
      shelfId: form.shelfId,
      areaTypeId: form.areaTypeId,
      dimensionUomId: form.dimensionUomId || undefined,
      binLength: Number(form.binLength),
      binWidth: Number(form.binWidth),
      binHeight: Number(form.binHeight),
      maxCapacity: Number(form.maxCapacity),
      isActive: form.isActive,
    };
    try {
      if (isNew) await api.post('/bins', payload);
      else await api.put(`/bins/${id}`, payload);
      navigate('/admin/bins');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
        <Link to="/admin/bins" className="btn-secondary">
          ← Back to bins
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/admin/bins"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {isNew ? 'Add Bin' : viewOnly ? 'Bin Detail' : 'Edit Bin'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Storage bin within a warehouse location.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <Section title="General">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bin Label" required error={fieldErrors.binLabel}>
              <input
                className="input"
                value={form.binLabel}
                onChange={(e) => set({ binLabel: e.target.value })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Bin Code" required error={fieldErrors.binCode}>
              <input
                className="input"
                value={form.binCode}
                onChange={(e) => set({ binCode: e.target.value })}
                disabled={viewOnly}
              />
            </Field>
          </div>
        </Section>

        <Section title="Location">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Warehouse" required error={fieldErrors.warehouseId}>
              <SearchableSelect
                value={form.warehouseId}
                onChange={(v) => set({ warehouseId: v })}
                disabled={viewOnly}
                placeholder="Select warehouse"
                searchPlaceholder="Search warehouse…"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Field>
            <Field label="Area Type" required error={fieldErrors.areaTypeId}>
              <SearchableSelect
                value={form.areaTypeId}
                onChange={(v) => set({ areaTypeId: v })}
                disabled={viewOnly}
                placeholder="Select area type"
                options={areaTypes.map((a) => ({
                  value: a.id,
                  label: `${a.areaTypeName} (${a.areaTypeCode})`,
                }))}
              />
            </Field>
            <Field label="Aisle" required error={fieldErrors.aisleId}>
              <SearchableSelect
                value={form.aisleId}
                onChange={(v) => set({ aisleId: v })}
                disabled={viewOnly}
                placeholder="Select aisle"
                options={aisles.map((a) => ({
                  value: a.id,
                  label: `${a.aisleName} (${a.aisleCode})`,
                }))}
              />
            </Field>
            <Field label="Shelf" required error={fieldErrors.shelfId}>
              <SearchableSelect
                value={form.shelfId}
                onChange={(v) => set({ shelfId: v })}
                disabled={viewOnly}
                placeholder="Select shelf"
                options={shelves.map((s) => ({
                  value: s.id,
                  label: `${s.shelfLabel} (${s.shelfCode})`,
                }))}
              />
            </Field>
          </div>
        </Section>

        <Section title="Dimensions & Capacity">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Length">
              <input
                type="number"
                step="any"
                className="input"
                value={form.binLength}
                onChange={(e) => set({ binLength: Number(e.target.value) })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Width">
              <input
                type="number"
                step="any"
                className="input"
                value={form.binWidth}
                onChange={(e) => set({ binWidth: Number(e.target.value) })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Height">
              <input
                type="number"
                step="any"
                className="input"
                value={form.binHeight}
                onChange={(e) => set({ binHeight: Number(e.target.value) })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Max Capacity">
              <input
                type="number"
                step="any"
                className="input"
                value={form.maxCapacity}
                onChange={(e) => set({ maxCapacity: Number(e.target.value) })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Dimension UOM">
              <SearchableSelect
                value={form.dimensionUomId}
                onChange={(v) => set({ dimensionUomId: v })}
                disabled={viewOnly}
                placeholder="—"
                options={uoms.map((u) => ({ value: u.id, label: u.uomCode }))}
              />
            </Field>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={form.isActive}
                onChange={(e) => set({ isActive: e.target.checked })}
                disabled={viewOnly}
              />
              Active
            </label>
          </div>
        </Section>

        <div className="flex justify-end gap-2">
          <Link to="/admin/bins" className="btn-secondary">
            {viewOnly ? 'Back' : 'Cancel'}
          </Link>
          {canManage && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save bin'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <FormField label={label} required={required} error={error}>
      {children}
    </FormField>
  );
}
