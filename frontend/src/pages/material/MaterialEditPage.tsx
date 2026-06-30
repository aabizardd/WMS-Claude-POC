import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  Material,
  MaterialCategory,
  MaterialType,
  Uom,
} from '../../types';
import { useAuth } from '../../context/AuthContext';

interface FormState {
  materialCode: string;
  materialName: string;
  materialCategoryId: string;
  materialTypeId: string;
  primaryUomId: string;
  secondaryUomId: string;
  weightUomId: string;
  dimensionUomId: string;
  conversionRateQuantity: number;
  currency: string;
  materialLength: number;
  materialWidth: number;
  materialHeight: number;
  materialWeight: number;
  materialQty: number;
  isActive: boolean;
}

export default function MaterialEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [material, setMaterial] = useState<Material | null>(null);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [form, setForm] = useState<FormState | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const { has } = useAuth();
  const canUpdate = has('materials:update');
  const viewOnly = !canUpdate; // read-only when the user can't edit materials
  // Material came from Oracle: code & name are locked (owned by ERP).
  const fromErp = !!material?.erp_doc_id;

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.get<Material>(`/materials/${id}`),
      api.get<MaterialCategory[]>('/material-categories/options'),
      api.get<MaterialType[]>('/material-types/options'),
      api.get<Uom[]>('/uoms/options'),
    ])
      .then(([m, c, t, u]) => {
        if (!active) return;
        const mat = m.data;
        setMaterial(mat);
        setCategories(c.data);
        setTypes(t.data);
        setUoms(u.data);
        setForm({
          materialCode: mat.material_code,
          materialName: mat.material_name,
          materialCategoryId: mat.material_category?.id ?? '',
          materialTypeId: mat.material_type?.id ?? '',
          primaryUomId: mat.primary_uom?.id ?? '',
          secondaryUomId: mat.secondary_uom?.id ?? '',
          weightUomId: mat.weight_uom?.id ?? '',
          dimensionUomId: mat.dimension_uom?.id ?? '',
          conversionRateQuantity: mat.conversion_rate_quantity,
          currency: mat.currency ?? '',
          materialLength: mat.material_length,
          materialWidth: mat.material_width,
          materialHeight: mat.material_height,
          materialWeight: mat.material_weight,
          materialQty: mat.material_qty,
          isActive: mat.is_active,
        });
      })
      .catch(() => active && setLoadError('Failed to load material.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    setSaving(true);
    // Code & name are ignored by the API for ERP materials, but we only send
    // them for local ones to keep the payload honest.
    const payload = {
      ...(fromErp
        ? {}
        : { materialCode: form.materialCode, materialName: form.materialName }),
      materialCategoryId: form.materialCategoryId || undefined,
      materialTypeId: form.materialTypeId || undefined,
      primaryUomId: form.primaryUomId || undefined,
      secondaryUomId: form.secondaryUomId || undefined,
      weightUomId: form.weightUomId || undefined,
      dimensionUomId: form.dimensionUomId || undefined,
      conversionRateQuantity: Number(form.conversionRateQuantity),
      currency: form.currency || undefined,
      materialLength: Number(form.materialLength),
      materialWidth: Number(form.materialWidth),
      materialHeight: Number(form.materialHeight),
      materialWeight: Number(form.materialWeight),
      materialQty: Number(form.materialQty),
      isActive: form.isActive,
    };
    try {
      await api.put(`/materials/${id}`, payload);
      navigate('/admin/materials');
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

  if (loadError || !material || !form) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Material not found.'}
        </div>
        <Link to="/admin/materials" className="btn-secondary">
          ← Back to materials
        </Link>
      </div>
    );
  }

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/materials"
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
              {viewOnly ? 'Material Detail' : 'Edit Material'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {material.material_code}
              {material.material_name ? ` · ${material.material_name}` : ''}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            material.is_active
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {material.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {fromErp && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <div>
            <span className="font-medium">Synced from ERP</span> (ERP ID{' '}
            {material.erp_doc_id}). Code &amp; name come from Oracle and are
            locked — all other fields can still be edited here.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <Section title="General">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Material Code" locked={fromErp}>
                <input
                  className="input"
                  value={form.materialCode}
                  onChange={(e) => set({ materialCode: e.target.value })}
                  disabled={fromErp || viewOnly}
                  required
                />
              </Field>
              <Field label="Material Name" locked={fromErp}>
                <input
                  className="input"
                  value={form.materialName}
                  onChange={(e) => set({ materialName: e.target.value })}
                  disabled={fromErp || viewOnly}
                />
              </Field>
            </div>
          </Section>

          <Section title="Classification">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select
                  className="input"
                  value={form.materialCategoryId}
                  onChange={(e) => set({ materialCategoryId: e.target.value })}
                  disabled={viewOnly}
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.materialCategoryName} ({c.materialCategoryCode})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type">
                <select
                  className="input"
                  value={form.materialTypeId}
                  onChange={(e) => set({ materialTypeId: e.target.value })}
                  disabled={viewOnly}
                >
                  <option value="">—</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.materialTypeName} ({t.materialTypeCode})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Units of Measure">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <UomSelect
                label="Primary"
                value={form.primaryUomId}
                uoms={uoms}
                disabled={viewOnly}
                onChange={(v) => set({ primaryUomId: v })}
              />
              <UomSelect
                label="Secondary"
                value={form.secondaryUomId}
                uoms={uoms}
                disabled={viewOnly}
                onChange={(v) => set({ secondaryUomId: v })}
              />
              <UomSelect
                label="Weight"
                value={form.weightUomId}
                uoms={uoms}
                disabled={viewOnly}
                onChange={(v) => set({ weightUomId: v })}
              />
              <UomSelect
                label="Dimension"
                value={form.dimensionUomId}
                uoms={uoms}
                disabled={viewOnly}
                onChange={(v) => set({ dimensionUomId: v })}
              />
            </div>
          </Section>

          <Section title="Dimensions, Weight & Quantity">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <NumberField
                label="Length"
                value={form.materialLength}
                disabled={viewOnly}
                onChange={(v) => set({ materialLength: v })}
              />
              <NumberField
                label="Width"
                value={form.materialWidth}
                disabled={viewOnly}
                onChange={(v) => set({ materialWidth: v })}
              />
              <NumberField
                label="Height"
                value={form.materialHeight}
                disabled={viewOnly}
                onChange={(v) => set({ materialHeight: v })}
              />
              <NumberField
                label="Weight"
                value={form.materialWeight}
                disabled={viewOnly}
                onChange={(v) => set({ materialWeight: v })}
              />
              <NumberField
                label="Quantity"
                value={form.materialQty}
                disabled={viewOnly}
                onChange={(v) => set({ materialQty: v })}
              />
              <NumberField
                label="Conversion Rate"
                value={form.conversionRateQuantity}
                disabled={viewOnly}
                onChange={(v) => set({ conversionRateQuantity: v })}
              />
            </div>
          </Section>

          <Section title="Settings">
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
              <Field label="Currency">
                <input
                  className="input"
                  value={form.currency}
                  onChange={(e) => set({ currency: e.target.value })}
                  placeholder="e.g. IDR"
                  disabled={viewOnly}
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

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Link to="/admin/materials" className="btn-secondary">
              {viewOnly ? 'Back' : 'Cancel'}
            </Link>
            {canUpdate && (
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        </div>

        {/* Meta aside */}
        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Record info
            </h3>
            <dl className="space-y-3 text-sm">
              <Meta label="ERP ID" value={material.erp_doc_id ?? '—'} />
              <Meta label="Source" value={fromErp ? 'ERP (Oracle)' : 'WMS'} />
              <Meta label="Created by" value={material.created_by ?? '—'} />
              <Meta label="Modified by" value={material.modified_by ?? '—'} />
              <Meta
                label="Created at"
                value={
                  material.created_at
                    ? new Date(material.created_at).toLocaleString()
                    : '—'
                }
              />
              <Meta
                label="Modified at"
                value={
                  material.modified_at
                    ? new Date(material.modified_at).toLocaleString()
                    : '—'
                }
              />
            </dl>
          </div>
        </aside>
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
  locked,
  children,
}: {
  label: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">
        {label}
        {locked && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">
            ERP
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function UomSelect({
  label,
  value,
  uoms,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  uoms: Uom[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        className="input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {uoms.map((u) => (
          <option key={u.id} value={u.id}>
            {u.uomCode}
          </option>
        ))}
      </select>
    </Field>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step="any"
        className="input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
